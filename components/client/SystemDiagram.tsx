"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  hydrateClientMeters,
  loadClientMeters,
  type ClientMeter,
} from "@/lib/client-meters";
import { hydrateProjects, resolveMeterTypes, type MeterType } from "@/lib/projects";
import { hydrateDevices, loadDevices, type CatalogDevice } from "@/lib/devices";
import {
  clearDiagramState,
  hydrateDiagramState,
  loadDiagramState,
  saveDiagramState,
  type SavedDiagramDisplay,
} from "@/lib/diagram-db";
import {
  loadProjectGatewayLatest,
  type ProjectGatewaySample,
} from "@/lib/gateway-series";
import { formatStoredVietnam } from "@/lib/vietnam-time";
import { DiagramActionsContext } from "./diagram/context";
import {
  buildLiveMetrics,
  DIAGRAM_ONLINE_MS,
  formatMetricReading,
  normalizeMetricKeys,
  parameterGroups,
  resolveMetricKeys,
} from "./diagram/metrics";
import { MeterNode, NodeGlyph, SourceNode } from "./diagram/nodes";
import type {
  DiagramEdge,
  DiagramNode,
  DiagramNodeDisplay,
  DiagramParamOption,
  EnergyKind,
  MeterFlowNode,
  MeterIcon,
  MeterNodeData,
  SourceNodeData,
} from "./diagram/types";

const ICON_OPTIONS: { id: MeterIcon; label: string }[] = [
  { id: "plant", label: "Nhà máy" },
  { id: "cabinet", label: "Tủ điện" },
  { id: "fan", label: "Quạt/Máy nén" },
  { id: "meter", label: "Đồng hồ" },
  { id: "pump", label: "Bơm" },
  { id: "valve", label: "Van" },
  { id: "solar", label: "Pin mặt trời" },
  { id: "boiler", label: "Lò hơi" },
];

const nodeTypes: NodeTypes = {
  meter: MeterNode,
  source: SourceNode,
};

/** Dây dẫn sơ đồ đơn tuyến: luôn nét liền; vàng khi có dữ liệu, xám khi mất kết nối. */
const edgeStyle = { stroke: "#facc15", strokeWidth: 3 };
const offlineEdgeStyle = { stroke: "#475569", strokeWidth: 3 };

const SOURCE_NODE_ID = "__grid_source__";
const DEFAULT_GRID_LABEL = "LƯỚI ĐIỆN 22kV";
const SOURCE_W = 440;
const NODE_W = 264;
const H_GAP = 56;
const V_GAP = 320;

function waitForViewportPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

// ---------------- Persistence System ----------------

function saveDiagramPositions(
  projectId: string,
  energy: string,
  patches: Record<string, { x: number; y: number }>,
) {
  if (typeof window === "undefined") return;
  const current = loadDiagramState(projectId, energy);
  saveDiagramState({
    projectId,
    utility: energy,
    positions: { ...(current?.positions ?? {}), ...patches },
    viewport: current?.viewport,
    displays: current?.displays,
  });
}

function saveDiagramViewport(
  projectId: string,
  energy: string,
  viewport: Viewport,
) {
  if (typeof window === "undefined") return;
  const current = loadDiagramState(projectId, energy);
  saveDiagramState({
    projectId,
    utility: energy,
    positions: current?.positions ?? {},
    viewport: {
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      zoom: Number(viewport.zoom.toFixed(3)),
    },
    displays: current?.displays,
  });
}

function toSavedDisplays(displays: Record<string, DiagramNodeDisplay>) {
  const next: Record<string, SavedDiagramDisplay> = {};
  for (const [id, display] of Object.entries(displays)) {
    next[id] = {
      title: display.title,
      icon: display.icon,
      metricKeys: display.metricKeys,
    };
  }
  return next;
}

function fromSavedDisplays(raw: Record<string, SavedDiagramDisplay> | undefined) {
  const next: Record<string, DiagramNodeDisplay> = {};
  for (const [id, display] of Object.entries(raw ?? {})) {
    next[id] = {
      title: display.title,
      icon: display.icon as MeterIcon | undefined,
      metricKeys: display.metricKeys,
    };
  }
  return next;
}

function saveDiagramDisplays(
  projectId: string,
  energy: string,
  displays: Record<string, DiagramNodeDisplay>,
) {
  if (typeof window === "undefined") return;
  const current = loadDiagramState(projectId, energy);
  saveDiagramState({
    projectId,
    utility: energy,
    positions: current?.positions ?? {},
    viewport: current?.viewport,
    displays: toSavedDisplays(displays),
  });
}

/**
 * Đồng hồ không phải điện (Nước, Khí nén, Nhiệt, Hơi…): thông số là các dòng đã khai báo ở "Hàm nhận dữ liệu từ
 * gateway" của đồng hồ; chưa khai báo thì lấy các thông số có trong bản tin gần nhất. Đồng hồ điện: null (dùng danh
 * sách thông số điện chuẩn).
 */
function paramOptionsForMeter(
  meter: ClientMeter,
  devices: CatalogDevice[],
  sample: ProjectGatewaySample | undefined,
): DiagramParamOption[] | null {
  if (meter.utility === "Điện") return null;
  const device = meter.deviceId ? devices.find((item) => item.id === meter.deviceId) : undefined;
  const fromRegisters: DiagramParamOption[] = [];
  for (const row of device?.registers ?? []) {
    const key = row.address?.trim();
    if (!key || fromRegisters.some((item) => item.key === key)) continue;
    fromRegisters.push({ key, label: row.name?.trim() || key, unit: row.unit?.trim() || undefined });
  }
  if (fromRegisters.length) return fromRegisters;
  const fromSample = Object.keys(sample?.values ?? {}).map((key) => ({ key, label: key }));
  return fromSample.length ? fromSample : null;
}

function iconForUtility(utility: string): MeterIcon {
  if (utility === "Nước") return "pump";
  if (utility === "Hơi") return "boiler";
  if (utility === "Nhiệt") return "boiler";
  return "meter";
}

function isSampleOnline(at: string | undefined) {
  if (!at) return false;
  const ms = Date.parse(at.endsWith("Z") ? at : `${at}Z`);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms <= DIAGRAM_ONLINE_MS;
}

function nodeDataForMeter(
  meter: ClientMeter,
  display: DiagramNodeDisplay | undefined,
  sample: ProjectGatewaySample | undefined,
): MeterNodeData {
  const metricKeys = resolveMetricKeys(display);
  const live = buildLiveMetrics(metricKeys, sample?.values, {
    hasDevice: Boolean(meter.deviceId),
    online: isSampleOnline(sample?.at),
    code: meter.code,
    paramOptions: display?.paramOptions,
  });
  return {
    title: display?.title ?? meter.name,
    subtitle: meter.code,
    status: live.status,
    statusLabel: live.statusLabel,
    icon:
      display?.icon ??
      (meter.parentId === null && meter.utility === "Điện" ? "plant" : iconForUtility(meter.utility)),
    energy: meter.utility,
    listed: true,
    metricKeys,
    paramOptions: display?.paramOptions,
    metrics: live.metrics,
    sampleAt: sample?.at ? formatStoredVietnam(sample.at) ?? sample.at : undefined,
    lineLive: isSampleOnline(sample?.at),
  };
}

function buildSourceNodeData(
  projectName: string,
  energy: EnergyKind,
  meters: ClientMeter[],
  displays: Record<string, DiagramNodeDisplay>,
  liveById: Record<string, ProjectGatewaySample>,
): SourceNodeData {
  let normalCount = 0;
  let warningCount = 0;
  let offlineCount = 0;
  let totalPowerKw = 0;
  let hasPower = false;
  let sampleValues: Record<string, number> | undefined;

  const byParent = new Map<string | null, ClientMeter[]>();
  for (const meter of meters) {
    const key = meter.parentId && meters.some((m) => m.id === meter.parentId) ? meter.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(meter);
  }
  const roots = byParent.get(null) ?? meters;

  for (const meter of meters) {
    const sample = liveById[meter.id];
    const live = buildLiveMetrics(resolveMetricKeys(displays[meter.id]), sample?.values, {
      hasDevice: Boolean(meter.deviceId),
      online: isSampleOnline(sample?.at),
      code: meter.code,
    });
    if (live.status === "normal") normalCount += 1;
    else if (live.status === "warning") warningCount += 1;
    else offlineCount += 1;

    if (!sampleValues && sample?.values) {
      sampleValues = sample.values;
    }
  }

  for (const root of roots) {
    const vals = liveById[root.id]?.values;
    if (vals && typeof vals.Papt === "number" && Number.isFinite(vals.Papt)) {
      totalPowerKw += vals.Papt;
      hasPower = true;
    }
  }

  const totalPowerText = hasPower
    ? formatMetricReading("Papt", { Papt: totalPowerKw })
    : sampleValues
      ? formatMetricReading("Papt", sampleValues)
      : "—";
  const voltageText = sampleValues
    ? sampleValues.VLLavg != null
      ? formatMetricReading("VLLavg", sampleValues)
      : formatMetricReading("Van", sampleValues)
    : "380 V";

  return {
    title: `Trạm biến áp & Tủ tổng ${projectName}`,
    gridLabel: displays[SOURCE_NODE_ID]?.title?.trim() || DEFAULT_GRID_LABEL,
    subtitle:
      energy === "Điện"
        ? "Sơ đồ đơn tuyến hệ thống phân phối & đo đếm điện năng"
        : `Hệ thống cấp & đo đếm ${energy.toLowerCase()}`,
    energy,
    totalPowerText,
    voltageText,
    normalCount,
    warningCount,
    offlineCount,
  };
}

function buildFlowFromMeters(
  meters: ClientMeter[],
  displays: Record<string, DiagramNodeDisplay>,
  liveById: Record<string, ProjectGatewaySample>,
  projectName = "Dự án",
  energy: EnergyKind = "Điện",
): {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
} {
  const byParent = new Map<string | null, ClientMeter[]>();
  for (const meter of meters) {
    const key = meter.parentId && meters.some((m) => m.id === meter.parentId) ? meter.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(meter);
  }

  function subtreeWidth(id: string): number {
    const kids = byParent.get(id) ?? [];
    if (!kids.length) return NODE_W;
    return kids.reduce((sum, child) => sum + subtreeWidth(child.id), 0) + (kids.length - 1) * H_GAP;
  }

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  function place(meter: ClientMeter, centerX: number, y: number) {
    const nodeData = nodeDataForMeter(meter, displays[meter.id], liveById[meter.id]);
    nodes.push({
      id: meter.id,
      type: "meter",
      position: { x: centerX - NODE_W / 2, y },
      data: nodeData,
    });

    const kids = byParent.get(meter.id) ?? [];
    if (!kids.length) return;

    const totalW =
      kids.reduce((sum, child) => sum + subtreeWidth(child.id), 0) + (kids.length - 1) * H_GAP;
    let cursor = centerX - totalW / 2;
    for (const child of kids) {
      const w = subtreeWidth(child.id);
      const childCenter = cursor + w / 2;
      const childOnline = isSampleOnline(liveById[child.id]?.at);
      place(child, childCenter, y + V_GAP);
      edges.push({
        id: `e-${meter.id}-${child.id}`,
        source: meter.id,
        sourceHandle: "child",
        target: child.id,
        targetHandle: "parent",
        type: "step",
        animated: false,
        style: childOnline
          ? edgeStyle
          : offlineEdgeStyle,
      });
      cursor += w + H_GAP;
    }
  }

  const roots = byParent.get(null) ?? [];
  if (roots.length) {
    const totalRootsW =
      roots.reduce((sum, r) => sum + subtreeWidth(r.id), 0) + (roots.length - 1) * H_GAP;
    const busWidth = Math.max(totalRootsW + 80, SOURCE_W);
    const busCenterX = 80 + busWidth / 2;
    const busLeft = busCenterX - busWidth / 2;

    // Mỗi nhánh cấp 1 thả thẳng từ thanh cái xuống đúng vị trí của nó.
    const feeders: { id: string; x: number }[] = [];
    {
      let feederCursor = busCenterX - totalRootsW / 2;
      for (const root of roots) {
        const w = subtreeWidth(root.id);
        feeders.push({ id: root.id, x: feederCursor + w / 2 - busLeft });
        feederCursor += w + H_GAP;
      }
    }

    nodes.push({
      id: SOURCE_NODE_ID,
      type: "source",
      position: { x: busLeft, y: 16 },
      data: { ...buildSourceNodeData(projectName, energy, meters, displays, liveById), busWidth, feeders },
      draggable: false,
      selectable: false,
    });

    let cursor = busCenterX - totalRootsW / 2;
    const rootY = energy === "Điện" ? 276 : 168;
    for (const root of roots) {
      const w = subtreeWidth(root.id);
      const rootCenter = cursor + w / 2;
      const rootOnline = isSampleOnline(liveById[root.id]?.at);
      place(root, rootCenter, rootY);
      edges.push({
        id: `e-bus-${root.id}`,
        source: SOURCE_NODE_ID,
        sourceHandle: `bus-${root.id}`,
        target: root.id,
        targetHandle: "parent",
        type: "step",
        animated: false,
        style: rootOnline
          ? edgeStyle
          : offlineEdgeStyle,
      });
      cursor += w + H_GAP;
    }
  }

  return { nodes, edges };
}

export function SystemDiagram() {
  return (
    <ReactFlowProvider>
      <SystemDiagramInner />
    </ReactFlowProvider>
  );
}

function SystemDiagramInner() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? "default";
  const wrapperRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [energyFilters, setEnergyFilters] = useState<MeterType[]>(() => resolveMeterTypes(null));
  const [energy, setEnergy] = useState<EnergyKind>("Điện");
  const [projectName, setProjectName] = useState(projectId);
  const [meters, setMeters] = useState<ClientMeter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diagramVersion, setDiagramVersion] = useState(0);
  const [diagramStateReady, setDiagramStateReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [displays, setDisplays] = useState<Record<string, DiagramNodeDisplay>>({});
  const [devices, setDevices] = useState<CatalogDevice[]>(loadDevices);
  const [liveById, setLiveById] = useState<Record<string, ProjectGatewaySample>>({});
  const [liveTick, setLiveTick] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DiagramEdge>([]);
  const { fitView, setCenter, getNode, getViewport, setViewport } = useReactFlow();
  /** Hiển thị đã lưu + danh sách thông số riêng của đồng hồ không phải điện (chỉ lúc chạy, không lưu). */
  const effectiveDisplays = useMemo(() => {
    const next: Record<string, DiagramNodeDisplay> = { ...displays };
    for (const meter of meters) {
      const options = paramOptionsForMeter(meter, devices, liveById[meter.id]);
      if (options) next[meter.id] = { ...displays[meter.id], paramOptions: options };
    }
    return next;
  }, [displays, meters, devices, liveById]);
  const displaysRef = useRef(effectiveDisplays);
  const liveByIdRef = useRef(liveById);
  displaysRef.current = effectiveDisplays;
  liveByIdRef.current = liveById;

  const refreshLive = useCallback(() => {
    setLiveTick((value) => value + 1);
  }, []);

  const saveCurrentViewport = useCallback(() => {
    if (isCompactScreen()) return;
    saveDiagramViewport(projectId, energy, getViewport());
  }, [projectId, energy, getViewport]);

  const fitAndSaveViewport = useCallback(async () => {
    await fitView({ padding: 0.28, duration: 220 });
    await waitForViewportPaint();
    saveCurrentViewport();
  }, [fitView, saveCurrentViewport]);

  const reloadMeters = useCallback(() => {
    void hydrateClientMeters(projectId).then((rows) => setMeters(rows.length ? rows : loadClientMeters(projectId)));
  }, [projectId]);

  useEffect(() => {
    void hydrateProjects().then((projects) => {
      const project = projects.find((item) => item.id === projectId);
      setProjectName(project?.name ?? projectId);
      const types = resolveMeterTypes(project);
      setEnergyFilters(types);
      setEnergy((current) => (types.includes(current) ? current : types[0] ?? "Điện"));
    });
    reloadMeters();
  }, [projectId, reloadMeters]);

  useEffect(() => {
    const reloadDevices = () => void hydrateDevices().then(setDevices);
    reloadDevices();
    window.addEventListener("ems-devices-changed", reloadDevices);
    return () => window.removeEventListener("ems-devices-changed", reloadDevices);
  }, []);

  useEffect(() => {
    const onCustom = () => reloadMeters();
    window.addEventListener("ems-client-meters-changed", onCustom);
    return () => {
      window.removeEventListener("ems-client-meters-changed", onCustom);
    };
  }, [reloadMeters]);

  useEffect(() => {
    let active = true;
    setDiagramStateReady(false);
    setNodes([]);
    setEdges([]);
    setDisplays({});
    void hydrateDiagramState(projectId, energy)
      .catch(() => null)
      .then((state) => {
        if (!active) return;
        setDisplays(
          fromSavedDisplays(state?.displays ?? loadDiagramState(projectId, energy)?.displays),
        );
        setDiagramStateReady(true);
        setDiagramVersion((value) => value + 1);
      });
    return () => {
      active = false;
    };
  }, [projectId, energy, setNodes, setEdges]);

  useEffect(() => {
    let active = true;
    const load = () => {
      void loadProjectGatewayLatest(projectId).then((samples) => {
        if (!active) return;
        const next: Record<string, ProjectGatewaySample> = {};
        for (const sample of samples) next[sample.meterPointId] = sample;
        setLiveById(next);
      });
    };
    load();
    const timer = window.setInterval(load, 12_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId, liveTick]);

  // Build tree layout once meters / utility / saved state change
  useEffect(() => {
    if (!diagramStateReady) return;
    const filtered = meters.filter((meter) => meter.utility === energy);
    const built = buildFlowFromMeters(
      filtered,
      displaysRef.current,
      liveByIdRef.current,
      projectName,
      energy,
    );
    const savedState = loadDiagramState(projectId, energy);
    const savedPositions = savedState?.positions ?? {};
    const hasSavedSource = Boolean(savedPositions[SOURCE_NODE_ID]);

    const restoredNodes: DiagramNode[] = built.nodes.map((node) => {
      // Thanh cái tổng luôn theo bố cục tự động để các nhánh thả thẳng xuống đúng điểm đấu.
      const savedPos = node.type === "source" ? undefined : savedPositions[node.id];
      if (!savedPos) {
        return {
          ...node,
          selected: node.id === selectedId,
        };
      }
      // Nếu vị trí lưu từ bản cũ chưa có Thanh cái tổng ở trên (y < 180), tự động dịch xuống để không đè lên Trạm biến áp
      const adjustedY =
        !hasSavedSource && node.type === "meter" && savedPos.y < 180
          ? savedPos.y + 252
          : savedPos.y;
      return {
        ...node,
        position: { x: savedPos.x, y: adjustedY },
        selected: node.id === selectedId,
      };
    });

    setNodes(restoredNodes);
    setEdges(built.edges);

    const ids = new Set(filtered.map((meter) => meter.id));
    if (selectedId && !ids.has(selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
      setSettingsOpen(false);
    } else if (!selectedId && filtered[0]) {
      setSelectedId(filtered[0].id);
    }

    if (savedState?.viewport && hasSavedSource && !isCompactScreen()) {
      const vp = savedState.viewport;
      const frame = requestAnimationFrame(() => {
        setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
      });
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => fitView({ padding: 0.22, duration: 200 }));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meters, energy, projectName, setNodes, setEdges, fitView, setViewport, diagramVersion, diagramStateReady]);

  // Cập nhật giá trị realtime / lựa chọn thông số mà không reset vị trí / viewport
  useEffect(() => {
    if (!diagramStateReady) return;
    const filtered = meters.filter((meter) => meter.utility === energy);
    setNodes((current) =>
      current.map((item) => {
        if (item.type === "source") {
          const prev = item.data as SourceNodeData;
          return {
            ...item,
            data: {
              ...buildSourceNodeData(projectName, energy, filtered, effectiveDisplays, liveById),
              busWidth: prev.busWidth,
              feeders: prev.feeders,
            },
          };
        }
        if (item.type !== "meter") return item;
        const meter = meters.find((row) => row.id === item.id);
        if (!meter) return item;
        const nextData = nodeDataForMeter(meter, effectiveDisplays[item.id], liveById[item.id]);
        const prev = item.data as MeterNodeData;
        return {
          ...item,
          data: {
            ...nextData,
            iconImage: prev.iconImage,
          },
          selected: item.id === selectedId,
        };
      }),
    );
    setEdges((current) =>
      current.map((edge) => {
        const targetOnline = isSampleOnline(liveById[edge.target]?.at);
        return {
          ...edge,
          animated: false,
          style: targetOnline
            ? edgeStyle
            : offlineEdgeStyle,
        };
      }),
    );
  }, [liveById, effectiveDisplays, meters, energy, projectName, selectedId, diagramStateReady, setNodes, setEdges]);

  useEffect(() => {
    setNodes((current) =>
      current.map((item) => ({ ...item, selected: item.id === selectedId })),
    );
  }, [selectedId, setNodes]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId && node.type === "meter") ?? null,
    [nodes, selectedId],
  );

  const selectedData = selectedNode?.data as MeterNodeData | undefined;
  const selectedMeter = useMemo(
    () => meters.find((meter) => meter.id === selectedId) ?? null,
    [meters, selectedId],
  );

  const diagramActions = useMemo(
    () => ({
      openSettings: (nodeId: string) => {
        setSelectedId(nodeId);
        setSettingsOpen(true);
        setNodes((current) =>
          current.map((item) => ({ ...item, selected: item.id === nodeId })),
        );
      },
      refreshLive,
      renameSource: (label: string) => {
        const title = label.trim();
        setDisplays((current) => {
          const next = { ...current };
          if (title && title !== DEFAULT_GRID_LABEL) next[SOURCE_NODE_ID] = { ...current[SOURCE_NODE_ID], title };
          else delete next[SOURCE_NODE_ID];
          saveDiagramDisplays(projectId, energy, next);
          return next;
        });
      },
    }),
    [setNodes, refreshLive, projectId, energy],
  );

  const updateSelectedDisplay = useCallback(
    (patch: DiagramNodeDisplay & { iconImage?: string }) => {
      if (!selectedId) return;
      const { iconImage: _ignored, ...persisted } = patch;
      setDisplays((current) => {
        const next = {
          ...current,
          [selectedId]: {
            ...current[selectedId],
            ...persisted,
            metricKeys: persisted.metricKeys
              ? normalizeMetricKeys(persisted.metricKeys)
              : current[selectedId]?.metricKeys,
          },
        };
        saveDiagramDisplays(projectId, energy, next);
        return next;
      });
      if ("iconImage" in patch) {
        setNodes((current) =>
          current.map((item) => {
            if (item.id !== selectedId || item.type !== "meter") return item;
            const data = item.data as MeterNodeData;
            return {
              ...item,
              data: { ...data, iconImage: patch.iconImage },
            };
          }),
        );
      }
    },
    [selectedId, projectId, energy, setNodes],
  );

  const listedPoints = useMemo(() => {
    return meters
      .filter((meter) => meter.utility === energy)
      .map((meter) => {
        const display = effectiveDisplays[meter.id];
        const live = buildLiveMetrics(
          resolveMetricKeys(display),
          liveById[meter.id]?.values,
          {
            hasDevice: Boolean(meter.deviceId),
            online: isSampleOnline(liveById[meter.id]?.at),
            code: meter.code,
          },
        );
        return {
          id: meter.id,
          name: display?.title ?? meter.name,
          status: live.status,
          energy: meter.utility,
          code: meter.code,
          deviceId: meter.deviceId,
          serialNumber: meter.serialNumber,
        };
      });
  }, [meters, energy, effectiveDisplays, liveById]);

  const selectPoint = (id: string) => {
    setSelectedId(id);
    setSettingsOpen(false);
    setMobileListOpen(false);
    setNodes((current) =>
      current.map((item) => ({ ...item, selected: item.id === id })),
    );
    const node = getNode(id);
    if (!node) return;
    const width = node.measured?.width ?? NODE_W;
    const height = node.measured?.height ?? 160;
    setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1,
      duration: 280,
    });
  };

  // Reset layout back to default tree calculation (giữ lựa chọn thông số hiển thị)
  const handleResetLayout = useCallback(() => {
    clearDiagramState(projectId, energy);
    saveDiagramDisplays(projectId, energy, displays);
    const filtered = meters.filter((meter) => meter.utility === energy);
    const built = buildFlowFromMeters(filtered, effectiveDisplays, liveById, projectName, energy);
    setNodes(
      built.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedId,
      })),
    );
    setEdges(built.edges);
    fitView({ padding: 0.22, duration: 250 });
    setSavedNotice(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSavedNotice(false), 2000);
  }, [projectId, projectName, energy, meters, displays, effectiveDisplays, liveById, selectedId, setNodes, setEdges, fitView]);

  const configHref = `/du-an/${projectId}/cau-hinh`;

  return (
    <DiagramActionsContext.Provider value={diagramActions}>
      <div className="relative flex h-full min-h-0 bg-white font-sans">
        {mobileListOpen ? (
          <button
            type="button"
            aria-label="Đóng danh sách điểm đo"
            className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
            onClick={() => setMobileListOpen(false)}
          />
        ) : null}

        {/* Left Sidebar: Points List (Mobile Drawer / Desktop Static) */}
        <aside
          className={`${
            mobileListOpen ? "fixed inset-y-0 left-0 z-40 flex" : "hidden"
          } w-[min(290px,85vw)] shrink-0 flex-col border-r border-slate-200/80 bg-white shadow-2xl md:relative md:z-0 md:flex md:w-[250px] md:bg-slate-50/70 md:shadow-none lg:w-[280px]`}
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-200/60 bg-white">
            <div>
              <h2 className="text-xs font-bold tracking-wider uppercase text-slate-700">
                Danh sách điểm đo
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 transition-colors"
                aria-label="Cài đặt điểm đo"
                disabled={!selectedNode}
                onClick={() => {
                  if (selectedNode) {
                    setMobileListOpen(false);
                    setSettingsOpen(true);
                  }
                }}
                title="Tùy chỉnh hiển thị & thông số"
              >
                <GearIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMobileListOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 md:hidden"
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
            {listedPoints.length === 0 ? (
              <li className="px-3 py-8 text-center text-xs text-slate-400">
                Chưa có điểm đo nào cho loại {energy}.
              </li>
            ) : (
              listedPoints.map((point, index) => {
                const active = selectedId === point.id;
                return (
                  <li key={point.id}>
                    <button
                      type="button"
                      onClick={() => selectPoint(point.id)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                        active
                          ? "bg-slate-900 font-semibold text-white shadow-xs"
                          : "text-slate-700 hover:bg-slate-200/60"
                      }`}
                    >
                      <span className="min-w-0 truncate pr-2">
                        <span className="block truncate font-medium">
                          {index + 1}. {point.name}
                        </span>
                        <span
                          className={`block font-mono text-[10px] ${
                            active ? "text-slate-300" : "text-slate-400"
                          }`}
                        >
                          {point.code}
                          {point.serialNumber
                            ? ` • SN: ${point.serialNumber}`
                            : !point.deviceId
                              ? " • Chưa gán TB"
                              : ""}
                        </span>
                      </span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          point.status === "warning"
                            ? "bg-amber-500 ring-2 ring-amber-200"
                            : point.status === "normal"
                              ? "bg-emerald-500"
                              : "bg-slate-300"
                        }`}
                      />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        {/* Center: SCADA Canvas */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* Top Canvas Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-3 py-2 sm:px-6 sm:py-3">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setMobileListOpen(true)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs md:hidden"
              >
                <span>Điểm đo ({listedPoints.length})</span>
              </button>

              {/* Energy Utility Selector */}
              <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/60 p-1">
                {energyFilters.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setEnergy(item)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors sm:px-3 ${
                      energy === item
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-slate-600 hover:bg-white hover:text-slate-900"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {selectedNode ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 md:hidden"
              >
                <GearIcon className="h-3.5 w-3.5" />
                <span>Tùy chỉnh</span>
              </button>
            ) : null}
          </div>

          {/* React Flow Area */}
          <div ref={wrapperRef} className="relative flex min-h-0 flex-1">
            <div className="relative min-h-0 min-w-0 flex-1">
              <ReactFlow
                className="diagram-flow"
                // Đặt nền qua style: CSS gốc của React Flow (không thuộc layer Tailwind) đè lên class bg-*.
                style={{ backgroundColor: "#0b1220" }}
                colorMode="dark"
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => {
                  if (node.type === "meter") {
                    setSelectedId(node.id);
                    setSettingsOpen(true);
                  }
                }}
                onPaneClick={() => setSettingsOpen(false)}
                onNodeDragStop={(_, node, draggedNodes) => {
                  const patches: Record<string, { x: number; y: number }> = {};
                  const list = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
                  for (const n of list) {
                    patches[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
                  }
                  saveDiagramPositions(projectId, energy, patches);
                  setSavedNotice(true);
                  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
                  saveTimerRef.current = setTimeout(() => setSavedNotice(false), 2000);
                }}
                onMoveEnd={(_, viewport) => {
                  if (!isCompactScreen()) saveDiagramViewport(projectId, energy, viewport);
                }}
                nodesConnectable={false}
                edgesFocusable={false}
                elementsSelectable
                nodesDraggable
                minZoom={0.1}
                maxZoom={2.0}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={24} size={1} color="#334155" bgColor="#0b1220" />

                {savedNotice && (
                  <Panel position="top-right" className="m-2 sm:m-3">
                    <div className="flex items-center gap-2 rounded-xl bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md animate-fadeIn">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Đã lưu vị trí sơ đồ tự động</span>
                    </div>
                  </Panel>
                )}

                <Panel
                  position="top-center"
                  className="m-2 max-w-[calc(100vw-24px)] rounded-md border border-slate-600 bg-[#0b1220]/95 px-3 py-1.5 font-mono text-xs font-bold text-[#4ade80] sm:m-3 sm:px-4 sm:py-2 sm:text-sm"
                >
                  <p className="flex items-center gap-2 truncate">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4ade80]" />
                    <span className="truncate">SƠ ĐỒ ĐƠN TUYẾN · {projectName.toUpperCase()}</span>
                  </p>
                </Panel>

                <CanvasControls
                  onFit={fitAndSaveViewport}
                  onZoomChange={saveCurrentViewport}
                  onResetLayout={handleResetLayout}
                  onFullscreen={() => {
                    const el = wrapperRef.current;
                    if (!el) return;
                    if (document.fullscreenElement) {
                      void document.exitFullscreen();
                    } else {
                      void el.requestFullscreen();
                    }
                  }}
                />
              </ReactFlow>

              {listedPoints.length === 0 ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-2xl border border-slate-200 bg-white/95 px-6 py-5 text-center shadow-xs">
                    <CloudIcon className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                    <p className="text-xs font-medium text-slate-500">
                      Chưa có điểm đo nào cho loại {energy}.
                    </p>
                    <Link
                      href={configHref}
                      className="mt-3 inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white pointer-events-auto hover:bg-emerald-700"
                    >
                      Thêm điểm đo ngay
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Right Panel: Display Customization */}
            {settingsOpen && selectedData && selectedMeter ? (
              <>
                <button
                  type="button"
                  aria-label="Đóng tùy chỉnh điểm đo"
                  className="fixed inset-0 z-30 bg-slate-900/35 md:hidden"
                  onClick={() => setSettingsOpen(false)}
                />
                <NodeSettingsPanel
                  data={selectedData}
                  onClose={() => setSettingsOpen(false)}
                  onChange={updateSelectedDisplay}
                  onRefresh={refreshLive}
                />
              </>
            ) : null}
          </div>
        </section>
      </div>
    </DiagramActionsContext.Provider>
  );
}

// ---------------- Settings Panel ----------------

function NodeSettingsPanel({
  data,
  onClose,
  onChange,
  onRefresh,
}: {
  data: MeterNodeData;
  onClose: () => void;
  onChange: (patch: DiagramNodeDisplay & { iconImage?: string }) => void;
  onRefresh: () => void;
}) {
  const customParams = data.paramOptions?.length ? data.paramOptions : null;
  const currentKeys = customParams ? data.metricKeys : normalizeMetricKeys(data.metricKeys);
  const selectedKeys = new Set(currentKeys);
  // Đồng hồ không phải điện: chỉ liệt kê thông số đã khai báo cho đồng hồ; đồng hồ điện: danh sách thông số điện chuẩn.
  const groups = customParams
    ? [["Thông số khai báo của đồng hồ", customParams.map((item) => ({ key: item.key, name: item.label, unit: item.unit ?? "" }))] as const]
    : parameterGroups();

  const toggleKey = (key: string) => {
    const next = currentKeys.includes(key)
      ? currentKeys.filter((item) => item !== key)
      : [...currentKeys, key];
    const fallback = customParams ? resolveMetricKeys({ paramOptions: customParams }) : normalizeMetricKeys(null);
    onChange({ metricKeys: next.length ? next : [...fallback] });
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(320px,88vw)] shrink-0 flex-col border-l border-slate-200 bg-white font-sans shadow-2xl md:relative md:z-0 md:w-[320px] md:shadow-lg">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-800">Tùy chỉnh điểm đo</h2>
          <p className="text-[11px] text-slate-400">Chọn thông số thực hiển thị trên sơ đồ</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Đóng cài đặt"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-xs">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
          <div className="min-w-0">
            <p className="font-semibold text-emerald-800">Số liệu realtime</p>
            <p className="truncate text-[11px] text-emerald-700/80">
              {data.sampleAt ? `Cập nhật ${data.sampleAt}` : "Chưa có bản tin gateway"}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-xs ring-1 ring-emerald-200 hover:bg-emerald-50"
          >
            Làm mới
          </button>
        </div>

        <SettingsField label="TÊN HIỂN THỊ">
          <input
            value={data.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-500 focus:bg-white focus:ring-1 focus:ring-emerald-500"
          />
        </SettingsField>

        <SettingsField label="GIÁ TRỊ HIỂN THỊ TRÊN THẺ">
          <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
            {customParams
              ? "Tick các thông số đã khai báo ở Hàm nhận dữ liệu của đồng hồ. Thẻ sơ đồ sẽ hiện giá trị gateway thực."
              : "Tick các thông số (dòng điện, điện áp, công suất…). Thẻ sơ đồ sẽ hiện giá trị gateway thực."}
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {currentKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleKey(key)}
                className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white"
                title="Bỏ chọn"
              >
                {key} ×
              </button>
            ))}
          </div>
          <div className="max-h-[280px] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-2">
            {groups.map(([group, params]) => (
              <div key={group}>
                <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {group}
                </p>
                <ul className="space-y-0.5">
                  {params.map((param) => {
                    const active = selectedKeys.has(param.key);
                    return (
                      <li key={param.key}>
                        <label
                          className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                            active ? "bg-white shadow-xs ring-1 ring-emerald-200" : "hover:bg-white/80"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleKey(param.key)}
                            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-700">{param.name}</span>
                            <span className="block text-[10px] text-slate-400">
                              {param.key}
                              {param.unit ? ` · ${param.unit}` : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </SettingsField>

        <SettingsField label="BIỂU TƯỢNG HỆ THỐNG">
          <div className="grid grid-cols-4 gap-2">
            {ICON_OPTIONS.map((option) => {
              const active = data.icon === option.id && !data.iconImage;
              return (
                <button
                  key={option.id}
                  type="button"
                  title={option.label}
                  onClick={() => onChange({ icon: option.id, iconImage: undefined })}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-[10px] transition-colors ${
                    active
                      ? "border-emerald-500 bg-emerald-50/70 font-semibold text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow-xs">
                    <NodeGlyph type={option.id} className="h-4 w-4" />
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </SettingsField>

        <SettingsField label="ẢNH MINH HỌA TÙY CHỈNH">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center transition-colors hover:border-emerald-500 hover:bg-emerald-50/30">
            {data.iconImage ? (
              <img
                src={data.iconImage}
                alt="Biểu tượng tùy chỉnh"
                className="mb-2 h-14 w-14 rounded-xl object-cover shadow-xs"
              />
            ) : (
              <ImageIcon className="mb-2 h-6 w-6 text-slate-400" />
            )}
            <span className="text-xs font-medium text-slate-600">
              {data.iconImage ? "Chọn ảnh khác" : "Tải ảnh thiết bị lên"}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                onChange({ iconImage: URL.createObjectURL(file) });
              }}
            />
          </label>
          {data.iconImage ? (
            <button
              type="button"
              onClick={() => onChange({ iconImage: undefined })}
              className="mt-2 text-xs font-medium text-rose-500 hover:underline"
            >
              Xóa ảnh, dùng icon mặc định
            </button>
          ) : null}
        </SettingsField>
      </div>
    </aside>
  );
}

function SettingsField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

// ---------------- Canvas Controls ----------------

function CanvasControls({
  onFit,
  onZoomChange,
  onResetLayout,
  onFullscreen,
}: {
  onFit: () => void | Promise<void>;
  onZoomChange: () => void;
  onResetLayout: () => void;
  onFullscreen: () => void;
}) {
  const { zoomIn, zoomOut } = useReactFlow();

  return (
    <Panel position="bottom-right" className="m-2 flex flex-row gap-1.5 font-sans sm:m-4 sm:flex-col sm:gap-2">
      <ControlButton
        label="Phóng to (+)"
        onClick={async () => {
          await zoomIn({ duration: 160 });
          await waitForViewportPaint();
          onZoomChange();
        }}
      >
        +
      </ControlButton>
      <ControlButton
        label="Thu nhỏ (-)"
        onClick={async () => {
          await zoomOut({ duration: 160 });
          await waitForViewportPaint();
          onZoomChange();
        }}
      >
        −
      </ControlButton>
      <ControlButton label="Vừa khung hình" onClick={() => void onFit()}>
        <FitIcon className="h-4 w-4" />
      </ControlButton>
      <ControlButton label="Đặt lại vị trí mặc định" onClick={onResetLayout}>
        <ResetIcon className="h-4 w-4" />
      </ControlButton>
      {/* iPhone không hỗ trợ toàn màn hình cho một phần trang: ẩn trên điện thoại */}
      <ControlButton label="Toàn màn hình" onClick={onFullscreen} className="hidden sm:flex">
        <ExpandIcon className="h-4 w-4" />
      </ControlButton>
    </Panel>
  );
}

function ControlButton({
  children,
  label,
  onClick,
  className = "flex",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`${className} h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-base text-slate-600 shadow-md hover:bg-slate-50 hover:text-slate-900 transition-colors`}
    >
      {children}
    </button>
  );
}

/**
 * Màn hình nhỏ (điện thoại, máy tính bảng dọc): góc nhìn đã lưu (zoom / vị trí) lấy từ màn hình rộng nên áp vào
 * sẽ chỉ thấy một góc sơ đồ. Trên màn hình nhỏ luôn thu vừa khung và không ghi đè góc nhìn đã lưu.
 */
function isCompactScreen() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

// ---------------- SVG Icons ----------------

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function FitIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M20 15v5h-5" />
    </svg>
  );
}

function ResetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 5h5v5M10 19H5v-5M19 9l-6 6M5 15l6-6" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}
