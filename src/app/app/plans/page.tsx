"use client";

import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type EngineerRow = {
  id: string;
  user_id: string | null;
  name: string;
  phone: string | null;
  is_active: boolean;
};

type ProjectRow = { id: string; name: string };

type ScheduleItemRow = {
  id: string;
  engineer_id: string;
  work_date: string; // YYYY-MM-DD
  project_id: string | null;
  title: string;
  details: string | null;
  item_type: "work" | "leave" | "move";
  priority: 1 | 2 | 3 | 4 | 5 | 6;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const VIEW_WEEKS = 4;
const VIEW_DAYS = VIEW_WEEKS * 7;

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeekMon(d: Date) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function weekdayLabel(i: number) {
  return ["一", "二", "三", "四", "五", "六", "日"][i] ?? "";
}

function clampStage(n: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (n <= 1) return 1;
  if (n >= 6) return 6;
  return Math.round(n) as any;
}

const STAGE_OPTIONS: Array<{ value: 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { value: 1, label: "硬體安裝定位" },
  { value: 2, label: "硬體穩定性調整" },
  { value: 3, label: "軟體參數設定" },
  { value: 4, label: "AI參數訓練" },
  { value: 5, label: "跑料驗證" },
  { value: 6, label: "教育訓練" },
];

function stageLabel(n: 1 | 2 | 3 | 4 | 5 | 6) {
  return STAGE_OPTIONS.find((x) => x.value === n)?.label ?? `階段${n}`;
}

export default function PlansPage() {
  const router = useRouter();

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  // ✅ 四週視圖起點：第一週的週一
  const [viewStart, setViewStart] = useState<Date>(() => startOfWeekMon(new Date()));

  const [engineers, setEngineers] = useState<EngineerRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<ScheduleItemRow[]>([]);

  // auth / role / scope
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myEngineerId, setMyEngineerId] = useState<string | null>(null);

  // modal
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formEngineerId, setFormEngineerId] = useState<string>("");
  const [formDate, setFormDate] = useState<string>("");
  const [formType, setFormType] = useState<"work" | "leave" | "move">("work");
  const [formProjectId, setFormProjectId] = useState<string | "">("");
  const [formTitle, setFormTitle] = useState<string>("");
  const [formDetails, setFormDetails] = useState<string>("");
  const [formPriority, setFormPriority] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [saving, setSaving] = useState(false);

  async function ensureLoggedIn() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message);

    const user = data.user;
    if (!user) {
      router.replace("/login");
      throw new Error("未登入");
    }
    setEmail(user.email ?? null);
    return user;
  }

  async function loadAuthContext() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message);

    const user = data.user;
    if (!user) {
      router.replace("/login");
      throw new Error("未登入");
    }

    setEmail(user.email ?? null);

    const uid = user.id;
    setMyUserId(uid);

    const role = (user.app_metadata as any)?.role;
    const admin = role === "admin";
    setIsAdmin(admin);

    return { user, uid, admin };
  }

  async function ensureMyEngineerRow(userId: string, fallbackEmail?: string | null) {
    const { data: prof, error: pErr } = await supabase.from("profiles").select("name").eq("id", userId).maybeSingle();
    if (pErr) throw new Error(pErr.message);

    const displayName = (prof?.name ?? fallbackEmail ?? "未命名").toString();

    const { data: eng, error: eErr } = await supabase.from("engineers").select("id").eq("user_id", userId).maybeSingle();
    if (eErr) throw new Error(eErr.message);

    if (!eng) {
      const { error: iErr } = await supabase.from("engineers").insert({
        user_id: userId,
        name: displayName,
        phone: null,
        is_active: true,
      });
      if (iErr) throw new Error(iErr.message);
    }
  }

  async function loadEngineers(admin: boolean, uid: string) {
    let q = supabase
      .from("engineers")
      .select("id,user_id,name,phone,is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (!admin) q = q.eq("user_id", uid);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const list = (data ?? []) as EngineerRow[];
    setEngineers(list);

    if (!admin) {
      const my = list[0]?.id ?? null;
      setMyEngineerId(my);
      setFormEngineerId((prev) => prev || (my ?? ""));
    } else {
      setMyEngineerId(null);
    }

    return list;
  }

  async function loadProjects() {
    const { data, error } = await supabase.from("projects").select("id,name").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    setProjects((data ?? []) as ProjectRow[]);
  }

  // ✅ 載入四週（28天）資料
  async function loadScheduleForRange(startDate: Date, admin: boolean, myEngId: string | null) {
    const start = toISODate(startDate);
    const end = toISODate(addDays(startDate, VIEW_DAYS)); // exclusive

    let q = supabase
      .from("schedule_items")
      .select("id,engineer_id,work_date,project_id,title,details,item_type,priority,sort_order,created_at,updated_at")
      .gte("work_date", start)
      .lt("work_date", end)
      .order("work_date", { ascending: true })
      .order("engineer_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (!admin) {
      if (!myEngId) {
        setItems([]);
        return;
      }
      q = q.eq("engineer_id", myEngId);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    setItems((data ?? []) as ScheduleItemRow[]);
  }

  async function refresh() {
    setMsg("");
    setLoading(true);
    try {
      const { user, uid, admin } = await loadAuthContext();

      if (!admin) {
        await ensureMyEngineerRow(uid, user.email ?? null);
      }

      const eList = await loadEngineers(admin, uid);
      await loadProjects();

      const myEngIdLocal = admin ? null : eList[0]?.id ?? null;
      if (!admin && !myEngIdLocal) {
        throw new Error("找不到你的工程師資料（engineers.user_id 未綁定或 is_active=false）");
      }

      await loadScheduleForRange(viewStart, admin, myEngIdLocal);
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStart]);

  // ✅ 四個週起點（週一）
  const weekStarts = useMemo(
    () => Array.from({ length: VIEW_WEEKS }).map((_, w) => addDays(viewStart, w * 7)),
    [viewStart]
  );

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return (id: string | null) => (id ? m.get(id) ?? "（未知專案）" : "（未選專案）");
  }, [projects]);

  const itemsByCell = useMemo(() => {
    const m = new Map<string, ScheduleItemRow[]>();
    for (const it of items) {
      const k = `${it.engineer_id}__${it.work_date}`;
      const arr = m.get(k) ?? [];
      arr.push(it);
      m.set(k, arr);
    }
    return m;
  }, [items]);

  function cellBackground(list: ScheduleItemRow[] | undefined) {
    if (!list || list.length === 0) return "#fff";
    if (list.some((x) => x.item_type === "leave" || x.item_type === "move")) return "#ffe766";
    return "#fff";
  }

  function badgeColor(p: 1 | 2 | 3 | 4 | 5 | 6) {
    const palette = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6"];
    return palette[(p - 1) % palette.length];
  }

  function openNew(engineerId: string, dateISO: string) {
    setEditingId(null);

    const eid = isAdmin ? engineerId : myEngineerId ?? engineerId;

    setFormEngineerId(eid);
    setFormDate(dateISO);
    setFormType("work");
    setFormProjectId("");
    setFormTitle("");
    setFormDetails("");
    setFormPriority(1);
    setOpen(true);
  }

  function openEdit(it: ScheduleItemRow) {
    if (!isAdmin && myEngineerId && it.engineer_id !== myEngineerId) {
      setMsg("❌ 你沒有權限編輯別人的行程");
      return;
    }

    setEditingId(it.id);
    setFormEngineerId(it.engineer_id);
    setFormDate(it.work_date);
    setFormType(it.item_type);
    setFormProjectId(it.project_id ?? "");
    setFormTitle(it.title ?? "");
    setFormDetails(it.details ?? "");
    setFormPriority(clampStage(it.priority ?? 1));
    setOpen(true);
  }

  async function saveItem() {
    setMsg("");

    if (!formEngineerId) return setMsg("❌ 未選工程師");
    if (!formDate) return setMsg("❌ 未選日期");
    if (!formTitle.trim()) return setMsg("❌ 請輸入內容（title）");

    if (!isAdmin && myEngineerId && formEngineerId !== myEngineerId) {
      return setMsg("❌ 你只能新增/編輯自己的行程");
    }

    setSaving(true);
    try {
      await ensureLoggedIn();

      const payload = {
        engineer_id: formEngineerId,
        work_date: formDate,
        project_id: formProjectId ? formProjectId : null,
        title: formTitle.trim(),
        details: formDetails.trim() ? formDetails.trim() : null,
        item_type: formType,
        priority: formPriority,
      };

      if (!editingId) {
        const k = `${formEngineerId}__${formDate}`;
        const list = itemsByCell.get(k) ?? [];
        const nextSort = list.length === 0 ? 0 : Math.max(...list.map((x) => x.sort_order ?? 0)) + 1;

        const { error } = await supabase.from("schedule_items").insert({ ...payload, sort_order: nextSort });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("schedule_items").update(payload).eq("id", editingId);
        if (error) throw new Error(error.message);
      }

      setOpen(false);
      await loadScheduleForRange(viewStart, isAdmin, myEngineerId);
      setMsg("✅ 已儲存");
    } catch (e: any) {
      setMsg("❌ 儲存失敗：" + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem() {
    if (!editingId) return;
    const ok = confirm("確定要刪除這筆行程？");
    if (!ok) return;

    setSaving(true);
    setMsg("");
    try {
      await ensureLoggedIn();

      if (!isAdmin && myEngineerId && formEngineerId !== myEngineerId) {
        throw new Error("你只能刪除自己的行程");
      }

      const { error } = await supabase.from("schedule_items").delete().eq("id", editingId);
      if (error) throw new Error(error.message);

      setOpen(false);
      await loadScheduleForRange(viewStart, isAdmin, myEngineerId);
      setMsg("✅ 已刪除");
    } catch (e: any) {
      setMsg("❌ 刪除失敗：" + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.shell}>
      <div style={styles.sidebarWrap}>
        <Sidebar />
      </div>

      <div style={styles.main}>
        <div style={styles.topbar}>
          <div>
            <h1 style={styles.h1}>行程規劃</h1>
            <div style={styles.sub}>
              四週排班表（可編輯）· {email ?? ""}{" "}
              <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>
                {isAdmin ? "（管理員：全部）" : "（我的）"}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setViewStart((w) => addDays(w, -VIEW_DAYS))} style={styles.btn}>
              ← 前四週
            </button>
            <button onClick={() => setViewStart(startOfWeekMon(new Date()))} style={styles.btn}>
              本週
            </button>
            <button onClick={() => setViewStart((w) => addDays(w, VIEW_DAYS))} style={styles.btn}>
              後四週 →
            </button>
          </div>
        </div>

        {msg && (
          <div style={styles.alert}>
            <span>⚠️</span>
            {msg}
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.h2}>行程規劃（週排班表）</h2>
            <div style={{ fontSize: 12, color: "#6b7280" }}>點格子新增；點卡片可編輯。</div>
          </div>

          <div style={styles.cardBody}>
            {loading ? (
              <div style={{ color: "#6b7280" }}>載入中...</div>
            ) : (
              <div style={{ display: "grid", gap: 18 }}>
                {weekStarts.map((ws, wIdx) => {
                  const days7 = Array.from({ length: 7 }).map((_, i) => addDays(ws, i));
                  const weekTitle = `${ws.getMonth() + 1}月${ws.getDate()}日 - ${
                    days7[6].getMonth() + 1
                  }月${days7[6].getDate()}日（第${wIdx + 1}週）`;

                  return (
                    <div key={wIdx} style={styles.weekBlock}>
                      <div style={styles.weekTitle}>{weekTitle}</div>

                      <div style={{ overflowX: "auto" }}>
                        <table style={styles.table}>
                          <thead>
                            <tr>
                              <th style={styles.th}>工程師</th>
                              {days7.map((d, idx) => {
                                const label = `${d.getMonth() + 1}月${d.getDate()}日`;
                                const isWeekend = idx >= 5;
                                return (
                                  <th key={idx} style={{ ...styles.th, color: isWeekend ? "#c11" : "#111" }}>
                                    <div style={{ fontWeight: 900 }}>{label}</div>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>{weekdayLabel(idx)}</div>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>

                          <tbody>
                            {engineers.length === 0 ? (
                              <tr>
                                <td colSpan={8} style={{ padding: 14, border: "1px solid #e5e7eb" }}>
                                  {isAdmin
                                    ? "（尚無工程師資料。請先在 engineers 表新增。）"
                                    : "（找不到你的工程師資料。請確認 engineers.user_id 已綁定你的帳號，且 is_active=true。）"}
                                </td>
                              </tr>
                            ) : (
                              engineers.map((eng) => (
                                <tr key={eng.id}>
                                  <td style={styles.tdLeft}>
                                    <div style={{ fontWeight: 900 }}>{eng.name}</div>
                                    {eng.phone && <div style={{ fontSize: 12, opacity: 0.75 }}>{eng.phone}</div>}
                                  </td>

                                  {days7.map((d, idx) => {
                                    const dateISO = toISODate(d);
                                    const k = `${eng.id}__${dateISO}`;
                                    const list = itemsByCell.get(k) ?? [];

                                    return (
                                      <td
                                        key={idx}
                                        style={{
                                          ...styles.tdCell,
                                          background: cellBackground(list),
                                          cursor: "pointer",
                                        }}
                                        onClick={() => openNew(eng.id, dateISO)}
                                        title={isAdmin ? "點一下新增行程" : "點一下新增我的行程"}
                                      >
                                        {list.length === 0 ? (
                                          <div style={{ opacity: 0.35, fontSize: 12 }}>（空）</div>
                                        ) : (
                                          <div style={{ display: "grid", gap: 8 }}>
                                            {list.map((it) => (
                                              <div
                                                key={it.id}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openEdit(it);
                                                }}
                                                style={styles.itemCard}
                                                title="點一下編輯"
                                              >
                                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                                  <div style={{ fontWeight: 900, fontSize: 13, whiteSpace: "pre-wrap" }}>
                                                    {it.title}
                                                  </div>
                                                  <div
                                                    style={{
                                                      width: 10,
                                                      height: 10,
                                                      borderRadius: 999,
                                                      marginTop: 3,
                                                      background: badgeColor(it.priority),
                                                      flex: "0 0 auto",
                                                    }}
                                                    title={`階段：${stageLabel(it.priority)}`}
                                                  />
                                                </div>

                                                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                                                  {it.item_type === "leave"
                                                    ? "休假"
                                                    : it.item_type === "move"
                                                    ? "移動"
                                                    : `${projectName(it.project_id)} · ${stageLabel(it.priority)}`}
                                                </div>

                                                {it.details && (
                                                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, whiteSpace: "pre-wrap" }}>
                                                    {it.details}
                                                  </div>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}

                <div style={{ marginTop: 2, fontSize: 12, opacity: 0.7, color: "#6b7280" }}>
                  顏色規則：格子內包含「休假/移動」會整格變黃；卡片右上圓點代表 6 階段（用顏色做區分）。
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal */}
        {open && (
          <div style={styles.modalOverlay} onClick={() => !saving && setOpen(false)}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{editingId ? "編輯行程" : "新增行程"}</div>
                <button onClick={() => !saving && setOpen(false)} style={styles.btn}>
                  關閉
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={styles.label}>工程師</div>
                    <select
                      value={formEngineerId}
                      onChange={(e) => setFormEngineerId(e.target.value)}
                      style={styles.input}
                      disabled={saving || (!isAdmin && !!myEngineerId)}
                      title={!isAdmin ? "一般使用者只能編輯自己的行程" : ""}
                    >
                      {engineers.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    {!isAdmin && <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>（你只能新增/編輯自己的行程）</div>}
                  </div>

                  <div>
                    <div style={styles.label}>日期</div>
                    <input value={formDate} onChange={(e) => setFormDate(e.target.value)} style={styles.input} disabled={saving} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={styles.label}>類型</div>
                    <select value={formType} onChange={(e) => setFormType(e.target.value as any)} style={styles.input} disabled={saving}>
                      <option value="work">工作</option>
                      <option value="leave">休假</option>
                      <option value="move">移動</option>
                    </select>
                  </div>

                  <div>
                    <div style={styles.label}>專案（可選）</div>
                    <select
                      value={formProjectId}
                      onChange={(e) => setFormProjectId(e.target.value)}
                      style={styles.input}
                      disabled={saving || formType !== "work"}
                      title={formType !== "work" ? "休假/移動不需選專案" : ""}
                    >
                      <option value="">（未選專案）</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={styles.label}>階段</div>
                    <select
                      value={String(formPriority)}
                      onChange={(e) => setFormPriority(clampStage(Number(e.target.value)))}
                      style={styles.input}
                      disabled={saving || formType !== "work"}
                      title={formType !== "work" ? "休假/移動不需選階段" : ""}
                    >
                      {STAGE_OPTIONS.map((s) => (
                        <option key={s.value} value={String(s.value)}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div style={styles.label}>內容（title）</div>
                  <input
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    style={styles.input}
                    disabled={saving}
                    placeholder="例如：NAPA專案維修 / 休假 / 移動整合"
                  />
                </div>

                <div>
                  <div style={styles.label}>細節（可多行）</div>
                  <textarea
                    value={formDetails}
                    onChange={(e) => setFormDetails(e.target.value)}
                    style={{ ...styles.input, height: 90, resize: "vertical" }}
                    disabled={saving}
                    placeholder={"可輸入多行，例如：\nApply RTV & machine\nScrew sec.spreader\nASAA-14-317/318"}
                  />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  {editingId && (
                    <button onClick={deleteItem} style={{ ...styles.btn, background: "#fff" }} disabled={saving}>
                      刪除
                    </button>
                  )}
                  <button onClick={saveItem} style={styles.btn} disabled={saving}>
                    {saving ? "儲存中..." : "儲存"}
                  </button>
                </div>

                <div style={{ fontSize: 12, opacity: 0.7, color: "#6b7280" }}>
                  備註：點格子是新增；點卡片是編輯。實際權限以 Supabase RLS 為準（一般使用者只會看到/操作自己的資料）。
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: "flex", minHeight: "100vh", backgroundColor: "#f3f4f6" },
  sidebarWrap: { width: 260, flexShrink: 0, backgroundColor: "white", borderRight: "1px solid #e5e7eb" },
  main: { flex: 1, minWidth: 0, padding: 24 },

  topbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 },
  h1: { fontSize: 20, fontWeight: 600, margin: 0, marginBottom: 6, color: "#111827" },
  sub: { fontSize: 13, color: "#6b7280" },

  alert: {
    marginBottom: 16,
    padding: "12px 16px",
    backgroundColor: "#fef2f2",
    border: "1px solid #fee2e2",
    borderRadius: 8,
    color: "#b91c1c",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  card: { backgroundColor: "white", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden" },
  cardHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "#f9fafb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
  },
  h2: { fontSize: 16, fontWeight: 600, margin: 0, color: "#374151" },
  cardBody: { padding: 20 },

  btn: {
    padding: "8px 12px",
    fontSize: 14,
    color: "#6b7280",
    backgroundColor: "transparent",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.2s",
  },

  weekBlock: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    background: "#fff",
    overflow: "hidden",
  },
  weekTitle: {
    padding: "10px 12px",
    fontSize: 13,
    fontWeight: 900,
    background: "#f8fafc",
    borderBottom: "1px solid #e5e7eb",
    color: "#334155",
  },

  table: { borderCollapse: "collapse", minWidth: 1200, width: "100%", background: "#fff" },
  th: {
    border: "1px solid #000",
    padding: 10,
    background: "#ffe766",
    textAlign: "center",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  tdLeft: {
    border: "1px solid #000",
    padding: 10,
    background: "#fff",
    fontWeight: 900,
    width: 160,
    whiteSpace: "nowrap",
    verticalAlign: "top",
  },
  tdCell: { border: "1px solid #000", padding: 10, verticalAlign: "top", minWidth: 150 },

  itemCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 10,
    background: "#fff",
    cursor: "pointer",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modalCard: { width: "min(820px, 100%)", background: "#fff", borderRadius: 14, padding: 14, border: "1px solid #eee" },
  input: { width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", outline: "none" },
  label: { fontSize: 12, opacity: 0.75, marginBottom: 6, fontWeight: 800 },
};
