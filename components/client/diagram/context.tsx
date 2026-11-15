"use client";

import { createContext, useContext } from "react";

type DiagramActions = {
  openSettings: (nodeId: string) => void;
  refreshLive: () => void;
  /** Đổi nhãn nguồn cấp (chuỗi rỗng = về mặc định). */
  renameSource: (label: string) => void;
};

export const DiagramActionsContext = createContext<DiagramActions>({
  openSettings: () => {},
  refreshLive: () => {},
  renameSource: () => {},
});

export function useDiagramActions() {
  return useContext(DiagramActionsContext);
}
