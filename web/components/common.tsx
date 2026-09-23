"use client";
import { useState } from "react";
import {
  Check,
  Copy,
  Download,
  LoaderCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "./ui/button";
import { roles, download, count } from "@/lib/utils";
import type { RoleCode } from "@/lib/types";
export function RoleBadge({ role }: { role: RoleCode }) {
  return (
    <span className="role-badge" title={role}>
      <i style={{ background: roles[role].color }} />
      {roles[role].label}
    </span>
  );
}
export function Gid({
  gid,
  onSelect,
  copy = true,
}: {
  gid: string;
  onSelect?: (gid: string) => void;
  copy?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <span className="gid-group">
      {onSelect ? (
        <button className="gid link" onClick={() => onSelect(gid)}>
          {gid}
        </button>
      ) : (
        <span className="gid">{gid}</span>
      )}
      {copy && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Скопировать GID ${gid}`}
          title="Скопировать GID"
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(gid);
              setDone(true);
              setTimeout(() => setDone(false), 1800);
            } catch {
              setDone(false);
            }
          }}
        >
          {done ? <Check size={13} /> : <Copy size={13} />}
        </Button>
      )}
      <span className="sr-only" role="status">
        {done ? "GID скопирован" : ""}
      </span>
    </span>
  );
}
export function ExportButton({
  run,
  name,
  label,
}: {
  run: string;
  name: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <span className="export-control">
      <Button
        disabled={busy}
        title={`Скачать ${name}`}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            await download(`/api/runs/${run}/artifacts/${name}`, name);
            setMessage("Файл получен");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <Download size={15} />
        )}
        <span>{label || name}</span>
      </Button>
      {message && <small role="status">{message}</small>}
    </span>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error | string;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={18} />
      <span>{typeof error === "string" ? error : error.message}</span>
      {retry && <Button onClick={retry}>Повторить</Button>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Загрузка данных…
    </div>
  );
}
export function Pagination({
  page,
  total,
  size,
  onPage,
  onSize,
}: {
  page: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
  onSize?: (size: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        Показано {total ? count((page - 1) * size + 1) : 0}–
        {count(Math.min(page * size, total))} из {count(total)}
      </span>
      {onSize && (
        <select
          aria-label="Строк на странице"
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {[25, 50, 100].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label="Предыдущая страница"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={16} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Следующая страница"
        disabled={page * size >= total}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}
