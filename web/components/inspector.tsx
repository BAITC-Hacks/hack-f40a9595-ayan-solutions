"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Info,
  Sparkles,
  LoaderCircle,
  Send,
  ChevronRight,
  Network,
} from "lucide-react";
import type {
  AIResponse,
  Cluster,
  Connection,
  EdgeDetail,
  NodeDetail,
  Paged,
  Transaction,
} from "@/lib/types";
import { api, count, money, score, dateLabel } from "@/lib/utils";
import { Button } from "./ui/button";
import { ErrorState, Gid, Loading, Pagination, RoleBadge } from "./common";

export function TransactionTable({
  data,
  page,
  setPage,
  onSelect,
}: {
  data: Paged<Transaction>;
  page: number;
  setPage: (p: number) => void;
  onSelect: (gid: string) => void;
}) {
  return (
    <>
      <div className="table-scroll transactions-table">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Отправитель / получатель</th>
              <th className="numeric">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((t) => (
              <tr key={t.reference}>
                <td title={`Технический reference: ${t.reference}`}>
                  {dateLabel(t.date)}
                  <small>
                    {t.direction === "in"
                      ? "Входящий"
                      : t.direction === "self"
                        ? "Петля"
                        : "Исходящий"}
                  </small>
                </td>
                <td>
                  <Gid gid={t.source} onSelect={onSelect} copy={false} />
                  <br />
                  <Gid gid={t.target} onSelect={onSelect} copy={false} />
                </td>
                <td className="numeric">{money(t.sum_kzt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.total && <p className="empty">Наблюдаемых переводов нет.</p>}
      </div>
      <Pagination page={page} size={25} total={data.total} onPage={setPage} />
    </>
  );
}

function NodeOverview({
  detail,
  cluster,
  onNavigate,
}: {
  detail: NodeDetail;
  cluster?: Cluster;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="inspector-content">
      <section className="metric-grid">
        <div>
          <span>Наблюдаемые входящие</span>
          <strong>{money(detail.incoming_kzt)}</strong>
        </div>
        <div>
          <span>Наблюдаемые исходящие</span>
          <strong>{money(detail.outgoing_kzt)}</strong>
        </div>
        <div>
          <span>Отправители</span>
          <strong>{count(detail.unique_senders)}</strong>
        </div>
        <div>
          <span>Получатели</span>
          <strong>{count(detail.unique_receivers)}</strong>
        </div>
        <div>
          <span>Кластер</span>
          <button
            className="link"
            onClick={() => onNavigate(`/clusters/${detail.cluster_id}`)}
          >
            {detail.cluster_id} <ArrowUpRight size={13} />
          </button>
        </div>
        <div>
          <span>Глубина</span>
          <strong>{detail.depth}</strong>
        </div>
        <div>
          <span>Входящие переводы</span>
          <strong>{count(detail.in_tx)}</strong>
        </div>
        <div>
          <span>Исходящие переводы</span>
          <strong>{count(detail.out_tx)}</strong>
        </div>
      </section>
      <section>
        <h3>Исходящие / входящие в выборке</h3>
        <strong className="ratio">
          {detail.observed_out_in_ratio === null
            ? "Не определено"
            : score(detail.observed_out_in_ratio)}
        </strong>
        <p className="muted">
          Соотношение сумм не доказывает движение одних и тех же денег.
        </p>
      </section>
      <section>
        <h3>Почему назначена эта роль</h3>
        <p>{detail.evidence}</p>
        <ul className="rule-list">
          {detail.role_rules.map((rule) => (
            <li key={rule.code}>
              <span>{rule.label}</span>
              <strong>
                {String(rule.observed)}{" "}
                <small>
                  условие: {rule.operator} {String(rule.threshold)}
                </small>
              </strong>
            </li>
          ))}
        </ul>
        <p className="muted">
          Оценка соответствия роли: <b>{score(detail.role_score)}</b>.
          Эвристика, не калиброванная вероятность.
        </p>
      </section>
      <section>
        <details>
          <summary>Почему такой приоритет</summary>
          <p>{detail.priority_explanation}</p>
          <div className="table-scroll">
            <table className="factor-table">
              <thead>
                <tr>
                  <th>Фактор</th>
                  <th>Норма</th>
                  <th>Вес</th>
                  <th>Вклад</th>
                </tr>
              </thead>
              <tbody>
                {detail.priority_factors.map((f) => (
                  <tr key={f.label}>
                    <td>{f.label}</td>
                    <td>{score(f.normalized)}</td>
                    <td>{score(f.weight)}</td>
                    <td>{score(f.contribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="link"
            onClick={() => onNavigate("/methodology?tab=rules")}
          >
            Методика расчёта <ArrowUpRight size={13} />
          </button>
        </details>
      </section>
      <section className="limitations">
        <h3>
          <Info size={15} /> Ограничения вывода
        </h3>
        {detail.warnings.map((w) => (
          <p key={w.code}>{w.message}</p>
        ))}
      </section>
      {cluster && (
        <section>
          <h3>Кластер {cluster.cluster_id}</h3>
          <p>
            {count(cluster.n_nodes)} узлов · {count(cluster.n_seed)} исходных
          </p>
          <p>
            Внутренние переводы: <b>{money(cluster.sum_kzt_internal)}</b>
          </p>
          <p className="muted">Гипотеза по правилам: {cluster.hypothesis}</p>
          <Button onClick={() => onNavigate(`/clusters/${cluster.cluster_id}`)}>
            Открыть кластер <ArrowUpRight size={14} />
          </Button>
        </section>
      )}
    </div>
  );
}

function Connections({
  run,
  gid,
  onSelect,
  onEdge,
}: {
  run: string;
  gid: string;
  onSelect: (gid: string) => void;
  onEdge: (id: string) => void;
}) {
  const [direction, setDirection] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["connections", run, gid, direction, q, page],
    queryFn: ({ signal }) =>
      api<Paged<Connection>>(
        `/api/runs/${run}/nodes/${gid}/connections?direction=${direction}&q=${encodeURIComponent(q)}&page=${page}`,
        { signal },
      ),
  });
  return (
    <div className="inspector-content">
      <div className="inline-controls">
        <select
          aria-label="Направление связей"
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Все направления</option>
          <option value="in">Входящие</option>
          <option value="out">Исходящие</option>
        </select>
        <input
          aria-label="Поиск контрагента"
          placeholder="GID контрагента"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <p className="muted">
        Уникальные направленные пары, не число транзакций.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          {!query.data.total && (
            <p className="empty">
              {q || direction !== "all"
                ? "Связи по этим условиям не найдены."
                : "Для этого узла в выгрузке нет связей."}
            </p>
          )}
          {query.data.items.map((c) => (
            <div className="connection-row" key={c.id}>
              <div>
                <span className="direction">
                  {c.direction === "in" ? (
                    <ArrowDownLeft size={16} />
                  ) : (
                    <ArrowUpRight size={16} />
                  )}{" "}
                  {c.direction === "self"
                    ? "Петля"
                    : c.direction === "in"
                      ? "Входящая"
                      : "Исходящая"}
                </span>
                <Gid gid={c.gid} onSelect={onSelect} />
                <RoleBadge role={c.role} />
              </div>
              <div>
                <b>{money(c.sum_kzt)}</b>
                <small>{count(c.n_tx)} переводов</small>
                <Button size="sm" variant="ghost" onClick={() => onEdge(c.id)}>
                  Показать связь <ChevronRight size={13} />
                </Button>
              </div>
            </div>
          ))}
          <Pagination
            page={page}
            size={25}
            total={query.data.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function Transactions({
  run,
  gid,
  onSelect,
}: {
  run: string;
  gid: string;
  onSelect: (gid: string) => void;
}) {
  const [direction, setDirection] = useState("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["transactions", run, gid, direction, sort, page],
    queryFn: ({ signal }) =>
      api<Paged<Transaction>>(
        `/api/runs/${run}/nodes/${gid}/transactions?direction=${direction}&sort=${sort}&page=${page}`,
        { signal },
      ),
  });
  return (
    <div className="inspector-content">
      <div className="inline-controls">
        <select
          aria-label="Направление переводов"
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Все переводы</option>
          <option value="in">Входящие</option>
          <option value="out">Исходящие</option>
        </select>
        <select
          aria-label="Сортировка переводов"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          <option value="date">По дате</option>
          <option value="amount">По сумме</option>
        </select>
      </div>
      <p className="muted">
        Исходные строки transactions. Время не добавляется к датам; повторные
        переводы сохранены.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <TransactionTable
          data={query.data}
          page={page}
          setPage={setPage}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function NodeAI({
  run,
  detail,
  onSelect,
}: {
  run: string;
  detail: NodeDetail;
  onSelect: (gid: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [action, setAction] = useState("explain");
  const [asked, setAsked] = useState("");
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["ai-answer", run, detail.gid, action, asked],
    queryFn: () =>
      api<AIResponse>(`/api/runs/${run}/ai`, {
        method: "POST",
        body: JSON.stringify({ gid: detail.gid, action, question: asked }),
      }),
    enabled: false,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({ type, text }: { type: string; text: string }) =>
      api<AIResponse>(`/api/runs/${run}/ai`, {
        method: "POST",
        body: JSON.stringify({ gid: detail.gid, action: type, question: text }),
      }),
    onSuccess: (data, variables) =>
      cache.setQueryData(
        ["ai-answer", run, detail.gid, variables.type, variables.text],
        data,
      ),
  });
  const request = (type: string, text = "") => {
    setAction(type);
    setAsked(text);
    if (!cache.getQueryData(["ai-answer", run, detail.gid, type, text]))
      mutation.mutate({ type, text });
  };
  const answer = query.data;
  return (
    <div className="inspector-content">
      <p>AI анализирует рассчитанные признаки и связи выбранного узла.</p>
      <div className="ai-actions">
        {[
          ["explain", "Объяснить роль"],
          ["challenge", "Проверить гипотезу"],
          ["next", "Что изучить дальше"],
        ].map(([type, label]) => (
          <Button
            key={type}
            disabled={mutation.isPending}
            onClick={() => request(type)}
          >
            <Sparkles size={14} />
            {label}
          </Button>
        ))}
      </div>
      <form
        className="question-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) request("question", question);
        }}
      >
        <label htmlFor="ai-question">Уточняющий вопрос</label>
        <textarea
          id="ai-question"
          value={question}
          maxLength={1000}
          rows={3}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Какие признаки поддерживают эту гипотезу?"
        />
        <Button type="submit" disabled={mutation.isPending || !question.trim()}>
          <Send size={14} />
          Отправить
        </Button>
      </form>
      {mutation.isPending && (
        <p role="status">
          <LoaderCircle className="spin" size={16} /> Запрос отправлен, ожидаем
          ответ…
        </p>
      )}
      {mutation.error && (
        <ErrorState
          error={mutation.error}
          retry={() => mutation.mutate({ type: action, text: asked })}
        />
      )}
      <section>
        <h3>Объяснение правил без LLM</h3>
        <p>{detail.evidence}</p>
      </section>
      {answer && (
        <div className="ai-answer">
          <p className="muted">
            {answer.mode === "llm"
              ? "AI-интерпретация"
              : "AI не настроен · объяснение правил"}
            {answer.cached ? " · из кэша" : ""}
          </p>
          <section>
            <h3>Наблюдаемые факты</h3>
            <dl>
              {answer.facts.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.value === null
                      ? "Не определено"
                      : typeof f.value === "boolean"
                        ? f.value
                          ? "Да"
                          : "Нет"
                        : String(f.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Интерпретация</h3>
            <p>{answer.interpretation}</p>
          </section>
          <section>
            <h3>Контраргументы</h3>
            {answer.counterarguments.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </section>
          <section>
            <h3>Следующая проверка</h3>
            <p>{answer.next_check}</p>
          </section>
          <section>
            <h3>Объекты анализа</h3>
            {answer.references.map((gid) => (
              <Gid key={gid} gid={gid} onSelect={onSelect} />
            ))}
            <small>
              Запуск {answer.run_id} · evidence {answer.evidence_version}
            </small>
          </section>
          <details>
            <summary>Подготовленный контекст</summary>
            {answer.preparation.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </details>
        </div>
      )}
      <p className="muted">
        AI может ошибаться в интерпретации. Роли, оценки и CSV не меняются от
        ответа. Данные отправляются внешнему AI только по запросу.
      </p>
    </div>
  );
}

function EdgeInspector({
  run,
  id,
  onSelect,
  onNeighborhood,
  onClose,
}: {
  run: string;
  id: string;
  onSelect: (gid: string) => void;
  onNeighborhood: (gid: string) => void;
  onClose: () => void;
}) {
  const [source, target] = id.split(":");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["edge", run, id, page],
    queryFn: ({ signal }) =>
      api<EdgeDetail>(
        `/api/runs/${run}/edges/${source}/${target}?page=${page}`,
        { signal },
      ),
  });
  return (
    <>
      <header className="inspector-header">
        <h2>Направленная связь</h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Закрыть инспектор"
          onClick={onClose}
        >
          <X size={17} />
        </Button>
      </header>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <div className="inspector-content">
          <Gid gid={source} onSelect={onSelect} />
          <RoleBadge role={query.data.source_role} />
          <ArrowRight size={17} />
          <Gid gid={target} onSelect={onSelect} />
          <RoleBadge role={query.data.target_role} />
          <section className="metric-grid">
            <div>
              <span>Сумма за период</span>
              <strong>{money(query.data.sum_kzt)}</strong>
            </div>
            <div>
              <span>Переводы</span>
              <strong>{count(query.data.n_tx)}</strong>
            </div>
          </section>
          <Button onClick={() => onNeighborhood(source)}>
            <Network size={15} />
            Окружение отправителя
          </Button>
          <h3>Фактические переводы по паре</h3>
          <TransactionTable
            data={query.data.transactions}
            page={page}
            setPage={setPage}
            onSelect={onSelect}
          />
        </div>
      )}
    </>
  );
}

export default function ObjectInspector({
  run,
  selected,
  clusters,
  onSelect,
  onNeighborhood,
  onNavigate,
  hidden,
  first,
}: {
  run: string;
  selected: string;
  clusters: Cluster[];
  onSelect: (id: string) => void;
  onNeighborhood: (gid: string) => void;
  onNavigate: (path: string) => void;
  hidden: boolean;
  first?: string;
}) {
  const [tab, setTab] = useState("overview");
  const isEdge = selected.includes(":");
  const query = useQuery({
    queryKey: ["node", run, selected],
    queryFn: ({ signal }) =>
      api<NodeDetail>(`/api/runs/${run}/nodes/${selected}`, { signal }),
    enabled: Boolean(selected) && !isEdge,
  });
  if (!selected)
    return (
      <div className="inspector-empty">
        <Network size={36} />
        <h2>Выберите узел</h2>
        <p>На графе или в таблице</p>
        {first && (
          <Button onClick={() => onSelect(first)}>
            Открыть первый по приоритету <ArrowRight size={15} />
          </Button>
        )}
      </div>
    );
  if (isEdge)
    return (
      <EdgeInspector
        key={selected}
        run={run}
        id={selected}
        onSelect={onSelect}
        onNeighborhood={onNeighborhood}
        onClose={() => onSelect("")}
      />
    );
  return (
    <>
      <header className="inspector-header">
        <div>
          <small>УЗЕЛ СЕТИ</small>
          <Gid gid={selected} />
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Закрыть инспектор"
          onClick={() => onSelect("")}
        >
          <X size={18} />
        </Button>
      </header>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <>
          <div className="inspector-summary">
            <RoleBadge role={query.data.role} />
            <span title="Относительный порядок проверки; не вероятность">
              Приоритет <b>{score(query.data.priority_score)}</b>
            </span>
            <div className="node-flags">
              {query.data.is_seed && <span>Исходный узел</span>}
              {query.data.depth === 4 && <span>Граница выгрузки</span>}
            </div>
            <div className="inspector-links">
              <button className="link" onClick={() => onNeighborhood(selected)}>
                <Network size={14} />
                Окружение
              </button>
              <button
                className="link"
                onClick={() => onNavigate(`/nodes/${selected}`)}
              >
                Полная карточка <ArrowUpRight size={14} />
              </button>
            </div>
            {hidden && (
              <div className="notice">
                Узел скрыт текущими фильтрами.
                <Button size="sm" onClick={() => onNeighborhood(selected)}>
                  Показать узел и связи
                </Button>
              </div>
            )}
          </div>
          <div className="tabs" role="tablist" aria-label="Разделы карточки">
            {[
              ["overview", "Обзор"],
              ["connections", "Связи"],
              ["transactions", "Переводы"],
              ["ai", "AI"],
            ].map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inspector-body" role="tabpanel">
            {tab === "overview" ? (
              <NodeOverview
                detail={query.data}
                cluster={clusters.find(
                  (c) => c.cluster_id === query.data.cluster_id,
                )}
                onNavigate={onNavigate}
              />
            ) : tab === "connections" ? (
              <Connections
                key={selected}
                run={run}
                gid={selected}
                onSelect={onSelect}
                onEdge={onSelect}
              />
            ) : tab === "transactions" ? (
              <Transactions
                key={selected}
                run={run}
                gid={selected}
                onSelect={onSelect}
              />
            ) : (
              <NodeAI
                key={`${run}:${selected}`}
                run={run}
                detail={query.data}
                onSelect={onSelect}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
