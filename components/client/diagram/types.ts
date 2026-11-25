import type { Edge, Node } from "@xyflow/react";

export type MeterStatus = "normal" | "warning" | "offline";
export type MeterIcon =
  | "plant"
  | "cabinet"
  | "fan"
  | "meter"
  | "pump"
  | "valve"
  | "solar"
  | "boiler";
export type EnergyKind = string;

export type MeterMetric = {
  key?: string;
  label: string;
  value: string;
};

export type DiagramNodeDisplay = {
  title?: string;
  icon?: MeterIcon;
  metricKeys?: string[];
};

export type MeterNodeData = {
  title: string;
  subtitle?: string;
  status: MeterStatus;
  statusLabel?: string;
  icon: MeterIcon;
  iconImage?: string;
  metrics: MeterMetric[];
  metricKeys: string[];
  sampleAt?: string;
  /** Dây nhánh tô vàng khi có bản tin gần đây (cùng điều kiện với đường nối từ thanh cái). */
  lineLive?: boolean;
  energy: EnergyKind;
  listed?: boolean;
};

export type SourceNodeData = {
  title: string;
  /** Nhãn nguồn cấp phía trên (mặc định "LƯỚI ĐIỆN 22kV"), người dùng tự sửa được. */
  gridLabel: string;
  subtitle: string;
  energy: EnergyKind;
  totalPowerText: string;
  voltageText: string;
  normalCount: number;
  warningCount: number;
  offlineCount: number;
  /** Chiều rộng thanh cái (px) để trải hết các nhánh lộ ra cấp 1. */
  busWidth?: number;
  /** Vị trí (px, tính từ mép trái thanh cái) của từng nhánh lộ ra: mỗi nhánh có handle riêng để thả thẳng xuống. */
  feeders?: { id: string; x: number }[];
};

export type MeterFlowNode = Node<MeterNodeData, "meter">;
export type SourceFlowNode = Node<SourceNodeData, "source">;
export type JunctionFlowNode = Node<Record<string, never>, "junction">;
export type DiagramNode = MeterFlowNode | SourceFlowNode | JunctionFlowNode;
export type DiagramEdge = Edge;
