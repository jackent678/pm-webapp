"use client";

import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type EngineerRow = {
  id: string;
  user_id: string | null; // ✅ 對應 auth.users.id
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
  priority: 1 | 2 | 3;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

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

function clampPriority(n: number): 1 | 2 | 3 {
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return 2;
}

export default function PlansPage() {
  const router = useRouter();

  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMon(new Date()));

  const [engineers, setEngineers] = useState<EngineerRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<ScheduleItemRow[]>([]);

  // ✅ auth / role / scope
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myEngineerId, setMyEngineerId] = useState<string | null>(null);

  // modal state
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formEngineerId, setFormEngineerId] = useState<string>("");
  const [formDate, setFormDate] = useState<string>("");
  const [formType, setFormType] = useState<"work" | "leave" | "move">("work");
  const [formProjectId, setFormProjectId] = useState<string | "">("");
  const [formTitle, setFormTitle] = useState<string>("");
  const [formDetails, setFormDetails] = useState<string>("");
  const [formPriority, setFormPriority] = useState<1 | 2 | 3>(2);
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

  // ✅ 讀取登入者 / admin 判斷（app_metadata.role === "admin"）
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

  // ✅ 確保「目前登入者」在 engineers 有一筆資料（非 admin 才需要）
  async function ensureMyEngineerRow(userId: string, fallbackEmail?: string | null) {
    // 1) 先拿 profiles.name
    const { data: prof, error: pErr } = await supabase.from("profiles").select("name").eq("id", userId).maybeSingle();
    if (pErr) throw new Error(pErr.message);

    const displayName = (prof?.name ?? fallbackEmail ?? "未命名").toString();

    // 2) 是否已有 engineer.user_id = userId
    const { data: eng, error: eErr } = await supabase.from("engineers").select("id").eq("user_id", userId).maybeSingle();
    if (eErr) throw new Error(eErr.message);

    // 3) 沒有就建立
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
    // ✅ RLS 會擋，但前端也加條件：非 admin 只拿自己的（省流量）
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

    // ✅ 非 admin：記下自己的 engineer_id（通常一筆）
    if (!admin) {
      const my = list[0]?.id ?? null;
      setMyEngineerId(my);
      // 如果 modal 沒開/或尚未選工程師，就直接綁定自己
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

  async function loadScheduleForWeek(ws: Date, admin: boolean, myEngId: string | null) {
    const start = toISODate(ws);
    const end = toISODate(addDays(ws, 7)); // exclusive

    let q = supabase
      .from("schedule_items")
      .select("id,engineer_id,work_date,project_id,title,details,item_type,priority,sort_order,created_at,updated_at")
      .gte("work_date", start)
      .lt("work_date", end)
      .order("work_date", { ascending: true })
      .order("engineer_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    // ✅ 非 admin：只載入自己的 schedule（更快；RLS 也會擋）
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

      // ✅ 一般使用者：確保 engineer row 存在
      if (!admin) {
        await ensureMyEngineerRow(uid, user.email ?? null);
      }

      const eList = await loadEngineers(admin, uid);
      await loadProjects();

      // ✅ 非 admin：用這次載入拿到的 engineer_id（避免 state 尚未同步）
      const myEngIdLocal = admin ? null : eList[0]?.id ?? null;
      if (!admin && !myEngIdLocal) {
        throw new Error("找不到你的工程師資料（engineers.user_id 未綁定或 is_active=false）");
      }

      await loadScheduleForWeek(weekStart, admin, myEngIdLocal);
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart]);

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

  function badgeColor(p: 1 | 2 | 3) {
    if (p === 1) return "#e74c3c";
    if (p === 2) return "#f39c12";
    return "#2ecc71";
  }

  function openNew(engineerId: string, dateISO: string) {
    setEditingId(null);

    // ✅ 非 admin：強制只能對自己的 engineer_id 新增
    const eid = isAdmin ? engineerId : myEngineerId ?? engineerId;

    setFormEngineerId(eid);
    setFormDate(dateISO);
    setFormType("work");
    setFormProjectId("");
    setFormTitle("");
    setFormDetails("");
    setFormPriority(2);
    setOpen(true);
  }

  function openEdit(it: ScheduleItemRow) {
    // ✅ 非 admin：若不是自己的資料（理論上拿不到；但以防萬一）
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
    setFormPriority(clampPriority(it.priority ?? 2));
    setOpen(true);
  }

  async function saveItem() {
    setMsg("");

    if (!formEngineerId) return setMsg("❌ 未選工程師");
    if (!formDate) return setMsg("❌ 未選日期");
    if (!formTitle.trim()) return setMsg("❌ 請輸入內容（title）");

    // ✅ 非 admin：前端先擋（避免一直看到 RLS 錯誤）
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

      // ✅ 重新載入（依 admin/自己的範圍）
      await loadScheduleForWeek(weekStart, isAdmin, myEngineerId);
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

      // ✅ 非 admin：前端先擋
      if (!isAdmin && myEngineerId && formEngineerId !== myEngineerId) {
        throw new Error("你只能刪除自己的行程");
      }

      const { error } = await supabase.from("schedule_items").delete().eq("id", editingId);
      if (error) throw new Error(error.message);

      setOpen(false);
      await loadScheduleForWeek(weekStart, isAdmin, myEngineerId);
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
              週排班表（可編輯） · {email ?? ""}{" "}
              <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>
                {isAdmin ? "（管理員：全部）" : "（我的）"}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setWeekStart((w) => addDays(w, -7))} style={styles.btn}>
              ← 上一週
            </button>
            <button onClick={() => setWeekStart(startOfWeekMon(new Date()))} style={styles.btn}>
              本週
            </button>
            <button onClick={() => setWeekStart((w) => addDays(w, 7))} style={styles.btn}>
              下一週 →
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
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>工程師</th>
                      {days.map((d, idx) => {
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

                          {days.map((d, idx) => {
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
                                        style={{
                                          border: "1px solid #e5e7eb",
                                          borderRadius: 10,
                                          padding: 10,
                                          background: "#fff",
                                          cursor: "pointer",
                                        }}
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
                                            title={`優先度 ${it.priority}`}
                                          />
                                        </div>

                                        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                                          {it.item_type === "leave"
                                            ? "休假"
                                            : it.item_type === "move"
                                            ? "移動"
                                            : projectName(it.project_id)}
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

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, color: "#6b7280" }}>
                  顏色規則：格子內包含「休假/移動」會整格變黃；卡片右上圓點代表優先度（1紅 2橘 3綠）。
                </div>
              </div>
            )}
          </div>
        </div>

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
                      disabled={saving || (!isAdmin && !!myEngineerId)} // ✅ 非 admin：鎖定
                      title={!isAdmin ? "一般使用者只能編輯自己的行程" : ""}
                    >
                      {engineers.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    {!isAdmin && (
                      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>（你只能新增/編輯自己的行程）</div>
                    )}
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
                    <div style={styles.label}>優先度</div>
                    <select
                      value={String(formPriority)}
                      onChange={(e) => setFormPriority(clampPriority(Number(e.target.value)))}
                      style={styles.input}
                      disabled={saving}
                    >
                      <option value="1">1（高）</option>
                      <option value="2">2（中）</option>
                      <option value="3">3（低）</option>
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

  table: { borderCollapse: "collapse", minWidth: 1200, width: "100%", background: "#fff" },
  th: { border: "1px solid #000", padding: 10, background: "#ffe766", textAlign: "center", verticalAlign: "middle", whiteSpace: "nowrap" },
  tdLeft: { border: "1px solid #000", padding: 10, background: "#fff", fontWeight: 900, width: 160, whiteSpace: "nowrap", verticalAlign: "top" },
  tdCell: { border: "1px solid #000", padding: 10, verticalAlign: "top", minWidth: 150 },

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
