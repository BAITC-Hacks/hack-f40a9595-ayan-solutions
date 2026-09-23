"use client";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
export const ResizablePanelGroup = PanelGroup;
export const ResizablePanel = Panel;
export function ResizableHandle() {
  return (
    <PanelResizeHandle
      className="resize-handle"
      aria-label="Изменить высоту графа и таблицы"
    >
      <span />
    </PanelResizeHandle>
  );
}
