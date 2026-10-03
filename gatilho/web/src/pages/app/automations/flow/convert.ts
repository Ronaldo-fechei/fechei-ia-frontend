import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { Flow, FlowEdge, FlowNode } from "@gatilho/shared";

export interface BlockData extends Record<string, unknown> {
  node: FlowNode;
}

export type BlockNodeType = Node<BlockData, "block">;

export const edgeDefaults = {
  type: "smoothstep" as const,
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#a1a1aa" },
  style: { stroke: "#a1a1aa" },
};

export function toReactFlow(flow: Flow): { nodes: BlockNodeType[]; edges: Edge[] } {
  return {
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: "block",
      position: n.position,
      data: { node: n },
      deletable: n.type !== "trigger",
    })),
    edges: flow.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, ...edgeDefaults })),
  };
}

export function fromReactFlow(nodes: BlockNodeType[], edges: Edge[]): Flow {
  const flowNodes: FlowNode[] = nodes.map((n) => ({ ...n.data.node, id: n.id, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }));
  const ids = new Set(flowNodes.map((n) => n.id));
  const flowEdges: FlowEdge[] = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? "out", target: e.target }));
  return { version: 1, nodes: flowNodes, edges: flowEdges };
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
