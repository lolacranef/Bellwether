// Supplier and ownership graph built from supplier_edges.csv.
// Edge direction: parent → child.
//   assembles:          child assembles the parent part
//   supplies_component: child supplies a component of the parent
//   owns:               parent owns child
//   affiliate_of:       treated as symmetric
import type { ComponentTrigger, Entity, PartsDataset, SupplierEdge } from "../model/types";

export interface TreeNode { node: string; path: string[]; grades: string[]; edge: SupplierEdge }
export interface RelatedNode { node: string; path: string[]; grades: string[] }

export class SupplyGraph {
  readonly children = new Map<string, SupplierEdge[]>();
  readonly owners = new Map<string, SupplierEdge[]>();
  readonly affiliates = new Map<string, { other: string; edge: SupplierEdge }[]>();
  private treeCache = new Map<string, TreeNode[]>();
  private relatedCache = new Map<string, RelatedNode[]>();
  private ultimateCache = new Map<string, RelatedNode>();

  constructor(readonly data: PartsDataset, readonly hops = 3) {
    for (const e of data.edges) {
      if (e.relationship === "assembles" || e.relationship === "supplies_component") push(this.children, e.parent_node_id, e);
      else if (e.relationship === "owns") push(this.owners, e.child_node_id, e);
      else {
        push(this.affiliates, e.parent_node_id, { other: e.child_node_id, edge: e });
        push(this.affiliates, e.child_node_id, { other: e.parent_node_id, edge: e });
      }
    }
  }

  entity(id: string): Entity | undefined { return this.data.entities[id]; }
  name(id: string): string { return this.data.entities[id]?.name ?? this.data.parts[id]?.sku ?? this.data.tenants[id]?.name ?? id; }

  /** Nodes of a part's supplier tree that a rule tests. The finished-device producer (assembler) is always tested. */
  treeNodes(root: string, trigger: ComponentTrigger): TreeNode[] {
    const key = `${root}|${trigger}`;
    const hit = this.treeCache.get(key);
    if (hit) return hit;
    const out: TreeNode[] = [];
    const seen = new Set<string>([root]);
    const visit = (id: string, path: string[], grades: string[], depth: number) => {
      for (const e of this.children.get(id) ?? []) {
        if (trigger === "FINISHED_DEVICE" && e.relationship !== "assembles") continue;
        const p = [...path, e.child_node_id];
        const g = [...grades, e.evidence_grade];
        const include = trigger === "CONTAINS_ANY_COMPONENT" || e.relationship === "assembles" || e.logic_bearing;
        if (include) out.push({ node: e.child_node_id, path: p, grades: g, edge: e });
        if (trigger !== "FINISHED_DEVICE" && depth < 6 && !seen.has(e.child_node_id)) {
          seen.add(e.child_node_id);
          visit(e.child_node_id, p, g, depth + 1);
        }
      }
    };
    visit(root, [], [], 0);
    this.treeCache.set(key, out);
    return out;
  }

  /** Owners (walking up) and affiliates within N hops, nearest first. Excludes the node itself. */
  related(node: string): RelatedNode[] {
    const hit = this.relatedCache.get(node);
    if (hit) return hit;
    const out: RelatedNode[] = [];
    const seen = new Set([node]);
    let frontier: RelatedNode[] = [{ node, path: [], grades: [] }];
    for (let h = 0; h < this.hops && frontier.length; h++) {
      const next: RelatedNode[] = [];
      for (const f of frontier) {
        const steps = [
          ...(this.owners.get(f.node) ?? []).map((e) => ({ other: e.parent_node_id, edge: e })),
          ...(this.affiliates.get(f.node) ?? []),
        ];
        for (const s of steps) {
          if (seen.has(s.other)) continue;
          seen.add(s.other);
          const r = { node: s.other, path: [...f.path, s.other], grades: [...f.grades, s.edge.evidence_grade] };
          out.push(r);
          next.push(r);
        }
      }
      frontier = next;
    }
    this.relatedCache.set(node, out);
    return out;
  }

  /** Follows the largest ownership stake upward to the top of the chain. */
  ultimateParent(node: string): RelatedNode {
    const hit = this.ultimateCache.get(node);
    if (hit) return hit;
    let cur = node;
    const path: string[] = [];
    const grades: string[] = [];
    const seen = new Set([node]);
    for (;;) {
      const ups = (this.owners.get(cur) ?? []).slice().sort((a, b) => (b.value_share_est ?? 0) - (a.value_share_est ?? 0));
      const up = ups.find((e) => !seen.has(e.parent_node_id));
      if (!up) break;
      cur = up.parent_node_id;
      seen.add(cur);
      path.push(cur);
      grades.push(up.evidence_grade);
    }
    const r = { node: cur, path, grades };
    this.ultimateCache.set(node, r);
    return r;
  }

  producerNationality(node: string): { country: string; path: string[]; grades: string[] } {
    const up = this.ultimateParent(node);
    return { country: this.entity(up.node)?.country_of_incorporation ?? "", path: up.path, grades: up.grades };
  }

  /** The finished-device producer: the first "assembles" child of a part. */
  assembler(part: string): string | undefined {
    return (this.children.get(part) ?? []).find((e) => e.relationship === "assembles")?.child_node_id;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}
