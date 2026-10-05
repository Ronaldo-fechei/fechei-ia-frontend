import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { ArrowLeft, CircleAlert, CircleCheck, CloudOff, FlaskConical, LoaderCircle, Maximize, Plus, Redo2, Rocket, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { defaultNodeData, flowChannels, getOutputHandles, NODE_INFO, validateFlow, type Flow, type FlowNode, type NodeType } from "@veloxia/shared";
import { Simulator } from "../../../../components/automation/Simulator";
import { StatusBadge } from "../../../../components/automation/badges";
import { useFields } from "../../../../components/automation/MessageEditor";
import { Button, ButtonLink, Callout, Drawer, EmptyState, IconButton, Skeleton } from "../../../../components/ui";
import { useAutomation, useAutomationActions } from "../../../../hooks/useAutomations";
import { api, errorMessage } from "../../../../lib/api";
import { cn } from "../../../../lib/cn";
import type { AutomationFull } from "../../../../lib/types";
import { useMediaQuery } from "../../../../lib/useMediaQuery";
import { BlockNode, FlowUiContext } from "./BlockNode";
import { edgeDefaults, fromReactFlow, newId, toReactFlow, type BlockNodeType } from "./convert";
import { NODE_STYLE, PALETTE_GROUPS } from "./meta";
import { NodeEditor, useTags } from "./NodeEditor";

const nodeTypes = { block: BlockNode };
type SaveState = "saved" | "dirty" | "saving" | "error";
interface Snapshot {
  nodes: BlockNodeType[];
  edges: Edge[];
}

function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  const onDragStart = (e: DragEvent, type: NodeType) => {
    e.dataTransfer.setData("application/veloxia-node", type);
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <div className="space-y-4 p-3">
      {PALETTE_GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{g.title}</p>
          <div className="space-y-1">
            {g.types.map((type) => (
              <button
                key={type}
                type="button"
                draggable
                onDragStart={(e) => onDragStart(e, type)}
                onClick={() => onAdd(type)}
                className="flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-left text-sm shadow-xs transition hover:border-brand-300 hover:shadow-card active:cursor-grabbing"
                title={NODE_INFO[type].description}
              >
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5", NODE_STYLE[type].bg, NODE_STYLE[type].color)}>{NODE_STYLE[type].icon}</span>
                <span className="truncate font-medium text-zinc-800">{NODE_INFO[type].label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="px-1 text-[11px] leading-relaxed text-zinc-400">Clique ou arraste um bloco para o quadro. Ligue os blocos arrastando a bolinha de saída até o próximo bloco.</p>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map = {
    saved: { icon: <CircleCheck className="size-4 text-emerald-500" />, text: "Salvo" },
    dirty: { icon: <LoaderCircle className="size-4 text-zinc-400" />, text: "Alterações pendentes" },
    saving: { icon: <LoaderCircle className="size-4 animate-spin text-zinc-400" />, text: "Salvando…" },
    error: { icon: <CloudOff className="size-4 text-red-500" />, text: "Erro ao salvar" },
  }[state];
  return (
    <span className="hidden items-center gap-1.5 text-xs text-zinc-500 md:flex" aria-live="polite">
      {map.icon}
      {map.text}
    </span>
  );
}

function Builder({ automation }: { automation: AutomationFull }) {
  const rf = useReactFlow();
  const initial = useMemo(() => toReactFlow(automation.draftFlow), [automation.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes] = useState<BlockNodeType[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [version, setVersion] = useState(0);
  const [name, setName] = useState(automation.name);
  const [testOpen, setTestOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const lastEditAt = useRef(0);
  const current = useRef<Snapshot>({ nodes, edges });
  current.current = { nodes, edges };
  const { data: tags } = useTags();
  const { data: fields } = useFields();
  const { invalidate, onError } = useAutomationActions();
  const [status, setStatus] = useState(automation.status);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const flow: Flow = useMemo(() => fromReactFlow(nodes, edges), [nodes, edges]);
  const validation = useMemo(() => validateFlow(flow), [flow]);
  const ui = useMemo(() => {
    const issues = new Map<string, string[]>();
    for (const e of validation.errors) if (e.nodeId) issues.set(e.nodeId, [...(issues.get(e.nodeId) ?? []), e.message]);
    return {
      issues,
      tagNames: new Map((tags?.tags ?? []).map((t) => [t.id, t.name])),
      fieldLabels: new Map((fields?.fields ?? []).map((f) => [f.key, f.label])),
    };
  }, [validation, tags, fields]);

  const markDirty = () => {
    setSaveState("dirty");
    setVersion((v) => v + 1);
  };
  const pushHistory = () => {
    history.current.past.push(structuredClone(current.current));
    if (history.current.past.length > 60) history.current.past.shift();
    history.current.future = [];
  };

  /* ------------------------------ salvamento automático ------------------------------ */
  const saving = useRef<Promise<void> | null>(null);
  const save = useCallback(async () => {
    const snapshot = fromReactFlow(current.current.nodes, current.current.edges);
    setSaveState("saving");
    const p = api
      .put(`/automations/${automation.id}/draft`, { flow: snapshot })
      .then(() => setSaveState((s) => (s === "saving" ? "saved" : s)))
      .catch((err) => {
        setSaveState("error");
        toast.error("Não foi possível salvar o fluxo", { description: errorMessage(err) });
        throw err;
      })
      .finally(() => {
        saving.current = null;
      });
    saving.current = p;
    return p;
  }, [automation.id]);

  useEffect(() => {
    if (version === 0) return;
    const t = setTimeout(() => save().catch(() => undefined), 1200);
    return () => clearTimeout(t);
  }, [version, save]);

  const flush = async () => {
    if (saving.current) await saving.current.catch(() => undefined);
    if (saveState !== "saved") await save();
  };

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [saveState]);

  /* ------------------------------ edição ------------------------------ */
  const onNodesChange = useCallback((changes: NodeChange<BlockNodeType>[]) => {
    const filtered = changes.filter((c) => !(c.type === "remove" && current.current.nodes.find((n) => n.id === c.id)?.data.node.type === "trigger"));
    if (filtered.some((c) => c.type === "remove")) pushHistory();
    setNodes((nds) => applyNodeChanges(filtered, nds));
    if (filtered.some((c) => c.type === "remove" || (c.type === "position" && c.dragging === false))) markDirty();
    const removed = filtered.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
    if (removed.length) setSelectedId((s) => (s && removed.includes(s) ? null : s));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((c) => c.type === "remove")) {
      pushHistory();
      markDirty();
    }
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const source = current.current.nodes.find((n) => n.id === c.source)?.data.node;
    const target = current.current.nodes.find((n) => n.id === c.target)?.data.node;
    if (!source || !target || c.source === c.target) return false;
    if (target.type === "trigger") return false;
    if (target.type === "keyword" && source.type !== "trigger") return false;
    return true;
  }, []);

  const onConnect = useCallback((c: Connection) => {
    const source = current.current.nodes.find((n) => n.id === c.source)?.data.node;
    if (!source) return;
    pushHistory();
    setEdges((eds) => {
      const keep = source.type === "trigger" ? eds : eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "out") === (c.sourceHandle ?? "out")));
      if (keep.some((e) => e.source === c.source && e.target === c.target && e.sourceHandle === c.sourceHandle)) return keep;
      return [...keep, { id: newId("e"), source: c.source!, target: c.target!, sourceHandle: c.sourceHandle ?? "out", ...edgeDefaults }];
    });
    markDirty();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateNodeData = (id: string, data: FlowNode["data"]) => {
    if (Date.now() - lastEditAt.current > 1500) pushHistory();
    lastEditAt.current = Date.now();
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { node: { ...n.data.node, data } } } : n)));
    // Botões removidos: remove conexões órfãs.
    setEdges((eds) => {
      const node = current.current.nodes.find((n) => n.id === id)?.data.node;
      if (!node) return eds;
      const handles = new Set(getOutputHandles({ ...node, data } as FlowNode).map((h) => h.id));
      return eds.filter((e) => e.source !== id || handles.has(e.sourceHandle ?? "out") || node.type === "trigger");
    });
    markDirty();
  };

  const addNode = (type: NodeType, position?: { x: number; y: number }) => {
    pushHistory();
    const id = newId(type);
    const data = defaultNodeData(type) as any;
    if (type === "buttons") data.buttons = [{ id: newId("b"), title: "Sim", kind: "reply" }, { id: newId("b"), title: "Não", kind: "reply" }];
    const selected = current.current.nodes.find((n) => n.id === selectedId);
    const trigger = current.current.nodes.find((n) => n.data.node.type === "trigger");
    let pos = position;
    if (!pos) {
      const anchor = type === "keyword" ? trigger : selected;
      if (anchor) pos = { x: anchor.position.x + (type === "keyword" ? (current.current.nodes.filter((n) => n.data.node.type === "keyword").length) * 280 : 0), y: anchor.position.y + 190 };
      else {
        const box = document.querySelector(".react-flow")?.getBoundingClientRect();
        pos = rf.screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 600) / 2 - 120, y: (box?.top ?? 0) + (box?.height ?? 400) / 2 - 60 });
      }
    }
    const node: FlowNode = { id, type, position: pos, data } as FlowNode;
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), { id, type: "block", position: pos!, data: { node }, selected: true, deletable: true }]);
    // Liga automaticamente ao bloco selecionado (ou ao gatilho, para palavras-chave).
    const from = type === "keyword" ? trigger : selected;
    if (from) {
      const handles = getOutputHandles(from.data.node).map((h) => h.id);
      const used = new Set(current.current.edges.filter((e) => e.source === from.id).map((e) => e.sourceHandle ?? "out"));
      const free = from.data.node.type === "trigger" ? "out" : handles.find((h) => !used.has(h));
      const allowed = type !== "keyword" || from.data.node.type === "trigger";
      if (free && allowed && from.data.node.type !== "end" && from.data.node.type !== "handoff") {
        setEdges((eds) => [...eds, { id: newId("e"), source: from.id, sourceHandle: free, target: id, ...edgeDefaults }]);
      }
    }
    setSelectedId(id);
    setPaletteOpen(false);
    markDirty();
  };

  const deleteNode = (id: string) => {
    const node = current.current.nodes.find((n) => n.id === id);
    if (!node || node.data.node.type === "trigger") return;
    pushHistory();
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
    markDirty();
  };

  const duplicateNode = (id: string) => {
    const node = current.current.nodes.find((n) => n.id === id);
    if (!node) return;
    pushHistory();
    const copy = structuredClone(node.data.node) as FlowNode;
    copy.id = newId(copy.type);
    copy.position = { x: node.position.x + 40, y: node.position.y + 60 };
    if (copy.type === "buttons") (copy.data as any).buttons = (copy.data as any).buttons.map((b: any) => ({ ...b, id: newId("b") }));
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), { id: copy.id, type: "block", position: copy.position, data: { node: copy }, selected: true, deletable: true }]);
    setSelectedId(copy.id);
    markDirty();
  };

  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(structuredClone(current.current));
    setNodes(prev.nodes);
    setEdges(prev.edges);
    markDirty();
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(structuredClone(current.current));
    setNodes(next.nodes);
    setEdges(next.edges);
    markDirty();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selectedId) {
        e.preventDefault();
        duplicateNode(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/veloxia-node") as NodeType;
    if (!type) return;
    addNode(type, rf.screenToFlowPosition({ x: e.clientX - 120, y: e.clientY - 30 }));
  };

  const renameAutomation = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === automation.name) return setName(automation.name);
    try {
      await api.patch(`/automations/${automation.id}`, { name: trimmed });
      invalidate(automation.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const publish = async () => {
    if (!validation.valid) {
      setIssuesOpen(true);
      toast.error("Corrija os itens destacados antes de publicar");
      return;
    }
    setPublishing(true);
    try {
      await flush();
      const res = await api.post<{ automation: AutomationFull }>(`/automations/${automation.id}/publish`);
      setStatus(res.automation.status);
      invalidate(automation.id);
      toast.success("Fluxo publicado! 🚀", { description: "A automação já responde às novas mensagens." });
    } catch (err) {
      onError(err);
    } finally {
      setPublishing(false);
    }
  };

  const openTest = async () => {
    try {
      await flush();
      setTestOpen(true);
    } catch {
      /* erro já exibido */
    }
  };

  const focusNode = (id: string) => {
    const n = current.current.nodes.find((x) => x.id === id);
    if (!n) return;
    setNodes((nds) => nds.map((x) => ({ ...x, selected: x.id === id })));
    setSelectedId(id);
    rf.setCenter(n.position.x + 120, n.position.y + 60, { zoom: 1, duration: 300 });
    setIssuesOpen(false);
  };

  const selected = nodes.find((n) => n.id === selectedId)?.data.node ?? null;
  const triggerEvent = nodes.find((n) => n.data.node.type === "trigger")?.data.node.data as { event?: string } | undefined;

  return (
    <FlowUiContext.Provider value={ui}>
      <div className="flex h-[calc(100dvh-4rem-4.5rem)] flex-col lg:h-[calc(100dvh-4rem)]">
        {/* Barra superior */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
          <Link to={`/app/automacoes/${automation.id}`} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label="Voltar">
            <ArrowLeft className="size-5" />
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={renameAutomation}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            maxLength={80}
            className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-base font-semibold hover:bg-zinc-50 focus:bg-white focus:ring-2 focus:ring-brand-200 focus:outline-none sm:max-w-xs"
            aria-label="Nome da automação"
          />
          <StatusBadge status={status} />
          <SaveIndicator state={saveState} />
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Desfazer (Ctrl+Z)" onClick={undo} disabled={!history.current.past.length}>
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton label="Refazer (Ctrl+Shift+Z)" onClick={redo} disabled={!history.current.future.length}>
              <Redo2 className="size-4" />
            </IconButton>
            <span className="mx-1 hidden h-5 w-px bg-zinc-200 sm:block" />
            <IconButton label="Aproximar" onClick={() => rf.zoomIn({ duration: 200 })} className="hidden sm:inline-flex">
              <ZoomIn className="size-4" />
            </IconButton>
            <IconButton label="Afastar" onClick={() => rf.zoomOut({ duration: 200 })} className="hidden sm:inline-flex">
              <ZoomOut className="size-4" />
            </IconButton>
            <IconButton label="Ajustar à tela" onClick={() => rf.fitView({ duration: 300, padding: 0.2 })}>
              <Maximize className="size-4" />
            </IconButton>
            <Button variant="secondary" size="sm" icon={<FlaskConical className="size-4" />} onClick={openTest}>
              <span className="hidden sm:inline">Testar fluxo</span>
            </Button>
            <Button size="sm" icon={<Rocket className="size-4" />} onClick={publish} loading={publishing}>
              Publicar
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {/* Paleta */}
          <aside className="scrollbar-thin hidden w-56 shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50 md:block">
            <Palette onAdd={(t) => addNode(t)} />
          </aside>

          {/* Quadro */}
          <div className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeDragStart={() => pushHistory()}
              onNodeClick={(_e, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              deleteKeyCode={["Backspace", "Delete"]}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.75}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={edgeDefaults}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#d4d4d8" />
              <Controls showInteractive={false} className="!shadow-card md:!hidden" />
              <MiniMap pannable zoomable className="!hidden !rounded-lg !border !border-zinc-200 lg:!block" nodeColor="#ffc8b5" maskColor="rgb(244 244 245 / 0.6)" />
            </ReactFlow>

            {/* Problemas de validação */}
            <div className="absolute bottom-4 left-4 z-10 max-w-sm">
              {issuesOpen && validation.errors.length > 0 && (
                <div className="mb-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-pop">
                  <p className="mb-2 text-sm font-semibold">Itens a corrigir</p>
                  <ul className="scrollbar-thin max-h-60 space-y-1.5 overflow-y-auto text-sm">
                    {validation.errors.map((e, i) => (
                      <li key={i}>
                        <button className="text-left text-red-700 hover:underline disabled:no-underline" disabled={!e.nodeId} onClick={() => e.nodeId && focusNode(e.nodeId)}>
                          • {e.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {validation.errors.length > 0 ? (
                <button onClick={() => setIssuesOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-pop">
                  <CircleAlert className="size-4" /> {validation.errors.length} item(ns) a corrigir
                </button>
              ) : (
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-pop">
                  <CircleCheck className="size-4" /> Pronto para publicar
                </span>
              )}
              {validation.warnings.filter((w) => !w.nodeId || !ui.issues.has(w.nodeId)).slice(0, 1).map((w, i) => (
                <p key={i} className="mt-2 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-card ring-1 ring-amber-200">
                  {w.message}
                </p>
              ))}
            </div>

            <Button className="absolute top-3 left-3 z-10 shadow-pop md:hidden" size="sm" icon={<Plus className="size-4" />} onClick={() => setPaletteOpen(true)}>
              Bloco
            </Button>
          </div>

          {/* Editor do bloco (desktop) */}
          {selected && isDesktop && (
            <aside className="scrollbar-thin w-[380px] shrink-0 overflow-y-auto border-l border-zinc-200 bg-white">
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-100 bg-white px-4 py-3">
                <span className={cn("flex size-7 items-center justify-center rounded-md [&>svg]:size-4", NODE_STYLE[selected.type].bg, NODE_STYLE[selected.type].color)}>{NODE_STYLE[selected.type].icon}</span>
                <p className="flex-1 font-semibold">{NODE_INFO[selected.type].label}</p>
                <button className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100" onClick={() => setSelectedId(null)} aria-label="Fechar editor">
                  ✕
                </button>
              </div>
              <div className="p-4">
                <NodeEditor
                  key={selected.id}
                  node={selected}
                  issues={ui.issues.get(selected.id) ?? []}
                  channels={flowChannels(flow)}
                  onChange={(data) => updateNodeData(selected.id, data)}
                  onDelete={() => deleteNode(selected.id)}
                  onDuplicate={() => duplicateNode(selected.id)}
                />
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Editor do bloco (telas menores) */}
      {!isDesktop && (
        <Drawer open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)} title={selected ? NODE_INFO[selected.type].label : ""} width="max-w-md">
          {selected && (
            <NodeEditor
              key={selected.id}
              node={selected}
              issues={ui.issues.get(selected.id) ?? []}
              channels={flowChannels(flow)}
              onChange={(data) => updateNodeData(selected.id, data)}
              onDelete={() => deleteNode(selected.id)}
              onDuplicate={() => duplicateNode(selected.id)}
            />
          )}
        </Drawer>
      )}

      <Drawer open={paletteOpen} onOpenChange={setPaletteOpen} title="Adicionar bloco" width="max-w-xs">
        <Palette onAdd={(t) => addNode(t)} />
      </Drawer>

      <Drawer open={testOpen} onOpenChange={setTestOpen} title="Testar fluxo" description="Usa o rascunho atual. Nenhuma mensagem é enviada." width="max-w-md">
        <Simulator automationId={automation.id} channels={flowChannels(flow)} defaultEvent={triggerEvent?.event === "new_follower" ? "dm" : triggerEvent?.event ?? "dm"} className="h-[calc(100dvh-9rem)]" />
      </Drawer>
    </FlowUiContext.Provider>
  );
}

export default function FlowBuilderPage() {
  const { id } = useParams();
  const { data, isLoading, isError } = useAutomation(id);
  if (isLoading) return <Skeleton className="m-6 h-[70vh]" />;
  if (isError || !data) {
    return <EmptyState title="Automação não encontrada" action={<ButtonLink to="/app/automacoes">Voltar</ButtonLink>} />;
  }
  if (data.automation.status === "archived") {
    return (
      <div className="p-6">
        <Callout tone="warning" title="Automação arquivada">
          Restaure a automação na lista para editá-la.
        </Callout>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Builder automation={data.automation} />
    </ReactFlowProvider>
  );
}
