"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import Link from "next/link";

type ProjectRow = { id: string; name: string };
type ProfileLite = { name: string | null };
type MaybeProfileJoin = ProfileLite | ProfileLite[] | null;

type IssueRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  severity: 1 | 2 | 3;
  status: "open" | "doing" | "done";
  reporter_id: string | null;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  assignee: ProfileLite | null;
};

function normalizeProfile(p: MaybeProfileJoin): ProfileLite | null {
  if (!p) return null;
  if (Array.isArray(p)) return p[0] ?? null;
  return p;
}

function clampSeverity(n: number): 1 | 2 | 3 {
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return 2;
}

export default function IssuesPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);

  // ✅ 改成：先選專案才顯示 issue
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  // ✅ 新增表單（綁定在目前選取專案）
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSeverity, setNewSeverity] = useState<1 | 2 | 3>(2);

  // ✅ 編輯 modal
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSeverity, setEditSeverity] = useState<1 | 2 | 3>(2);
  const [editStatus, setEditStatus] = useState<"open" | "doing" | "done">("open");
  const [saving, setSaving] = useState(false);

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return (id: string) => m.get(id) ?? "（未知專案）";
  }, [projects]);

  const stats = useMemo(() => {
    const open = issues.filter((i) => i.status === "open").length;
    const doing = issues.filter((i) => i.status === "doing").length;
    const done = issues.filter((i) => i.status === "done").length;
    return { open, doing, done, total: issues.length };
  }, [issues]);

  async function ensureLoggedIn() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message);
    if (!data.user) {
      router.replace("/login");
      throw new Error("未登入");
    }
    return data.user;
  }

  async function loadProjects() {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name")
      .order("created_at", { ascending: false });

    if (error) throw error;
    setProjects((data ?? []) as ProjectRow[]);
  }

  async function loadIssues(projectId: string) {
    const { data, error } = await supabase
      .from("issues")
      .select(
        `
        id,project_id,title,description,severity,status,reporter_id,assignee_id,created_at,updated_at,
        assignee:profiles!issues_assignee_id_fkey(name)
      `
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const normalized = (data ?? []).map((row: any) => ({
      ...row,
      assignee: normalizeProfile(row.assignee as MaybeProfileJoin),
    })) as IssueRow[];

    setIssues(normalized);
  }

  async function refreshAll() {
    setMsg("");
    try {
      await ensureLoggedIn();
      await loadProjects();

      // ✅ 如果已選專案，就一起刷新該專案 issues
      if (selectedProjectId) await loadIssues(selectedProjectId);
      else setIssues([]);
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "unknown"));
    }
  }

  async function selectProject(projectId: string) {
    setMsg("");
    setSelectedProjectId(projectId);
    setIssues([]);
    try {
      await ensureLoggedIn();
      await loadIssues(projectId);
    } catch (e: any) {
      setMsg("❌ 讀取 Issue 失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function createIssue() {
    setMsg("");
    try {
      const user = await ensureLoggedIn();

      if (!selectedProjectId) return setMsg("請先選擇專案");
      if (!newTitle.trim()) return setMsg("請輸入異常標題");

      const { error } = await supabase.from("issues").insert({
        project_id: selectedProjectId,
        title: newTitle.trim(),
        description: newDesc.trim() ? newDesc.trim() : null,
        severity: newSeverity,
        status: "open",
        reporter_id: user.id,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      setNewTitle("");
      setNewDesc("");
      setNewSeverity(2);

      await loadIssues(selectedProjectId);
      setMsg("✅ 已新增異常");
    } catch (e: any) {
      setMsg("❌ 新增失敗：" + (e?.message ?? "unknown"));
    }
  }

  function openEdit(it: IssueRow) {
    setEditingId(it.id);
    setEditTitle(it.title ?? "");
    setEditDesc(it.description ?? "");
    setEditSeverity(clampSeverity(it.severity ?? 2));
    setEditStatus(it.status);
    setEditOpen(true);
  }

  async function saveEdit() {
    setMsg("");
    if (!editingId) return;
    if (!editTitle.trim()) return setMsg("請輸入異常標題");

    setSaving(true);
    try {
      await ensureLoggedIn();

      const { error } = await supabase
        .from("issues")
        .update({
          title: editTitle.trim(),
          description: editDesc.trim() ? editDesc.trim() : null,
          severity: editSeverity,
          status: editStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingId);

      if (error) throw error;

      setEditOpen(false);
      if (selectedProjectId) await loadIssues(selectedProjectId);
      setMsg("✅ 已更新");
    } catch (e: any) {
      setMsg("❌ 更新失敗：" + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteIssue(issueId: string) {
    const ok = confirm("確定要刪除這筆 Issue？");
    if (!ok) return;

    setMsg("");
    try {
      await ensureLoggedIn();

      // ⚠️ 若你 DB 有 issue_comments 外鍵限制，請先刪留言（可選）
      // await supabase.from("issue_comments").delete().eq("issue_id", issueId);

      const { error } = await supabase.from("issues").delete().eq("id", issueId);
      if (error) throw error;

      if (selectedProjectId) await loadIssues(selectedProjectId);
      setMsg("✅ 已刪除");
    } catch (e: any) {
      setMsg("❌ 刪除失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function setIssueStatus(issueId: string, status: "open" | "doing" | "done") {
    setMsg("");
    try {
      await ensureLoggedIn();
      const { error } = await supabase
        .from("issues")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", issueId);
      if (error) throw error;

      if (selectedProjectId) await loadIssues(selectedProjectId);
    } catch (e: any) {
      setMsg("❌ 更新狀態失敗：" + (e?.message ?? "unknown"));
    }
  }

  async function assignToMe(issueId: string) {
    setMsg("");
    try {
      const user = await ensureLoggedIn();
      const { error } = await supabase
        .from("issues")
        .update({ assignee_id: user.id, updated_at: new Date().toISOString() })
        .eq("id", issueId);
      if (error) throw error;

      if (selectedProjectId) await loadIssues(selectedProjectId);
      setMsg("✅ 已指派給自己");
    } catch (e: any) {
      setMsg("❌ 指派失敗：" + (e?.message ?? "unknown"));
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />

      <div style={{ flex: 1, padding: 18, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Issues</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              {selectedProjectId
                ? `專案：${selectedProject?.name ?? "（未知）"} · 總數 ${stats.total} · 未處理 ${stats.open} · 處理中 ${stats.doing} · 已完成 ${stats.done}`
                : "請先選擇專案，才會顯示 Issue 列表"}
            </div>
          </div>

          <button onClick={refreshAll} style={{ padding: "6px 10px", cursor: "pointer" }}>
            重新整理
          </button>
        </div>

        {msg && <p style={{ marginTop: 10, color: msg.startsWith("✅") ? "#0a0" : "#d11" }}>{msg}</p>}

        {/* ✅ Step 1：專案列表 */}
        {!selectedProjectId ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>請選擇專案</div>

            {projects.length === 0 ? (
              <div style={{ padding: 14, border: "1px solid #eee", borderRadius: 10, opacity: 0.9 }}>
                （沒有可見專案，可能是 RLS 權限限制）
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProject(p.id)}
                    style={{
                      textAlign: "left",
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 12,
                      cursor: "pointer",
                      background: "#fff",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{p.name}</div>
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>點擊查看該專案 Issue</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ✅ 返回專案列表 */}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => {
                  setSelectedProjectId("");
                  setIssues([]);
                  setMsg("");
                }}
                style={{ padding: "6px 10px", cursor: "pointer" }}
              >
                ← 回專案列表
              </button>

              <div style={{ fontSize: 12, opacity: 0.75 }}>
                目前專案：<b>{projectName(selectedProjectId)}</b>
              </div>
            </div>

            {/* ✅ Step 2：新增 Issue（專案已鎖定，不再選專案） */}
            <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 900 }}>新增 Issue（{projectName(selectedProjectId)}）</div>

              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="異常標題（必填）"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />

                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="異常描述（可選）"
                  rows={3}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />

                <select
                  value={String(newSeverity)}
                  onChange={(e) => setNewSeverity(clampSeverity(Number(e.target.value)))}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  <option value="1">嚴重度：高</option>
                  <option value="2">嚴重度：中</option>
                  <option value="3">嚴重度：低</option>
                </select>

                <button onClick={createIssue} style={{ padding: "10px 14px", cursor: "pointer", borderRadius: 8 }}>
                  新增
                </button>
              </div>
            </div>

            {/* ✅ Step 3：Issue List */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontWeight: 900 }}>Issue 列表（點標題進詳細）</div>

              {issues.length === 0 ? (
                <p style={{ marginTop: 10 }}>目前沒有 Issue</p>
              ) : (
                <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                  {issues.map((it) => (
                    <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 900 }}>
                            <Link href={`/app/issues/${it.id}`} style={{ textDecoration: "none" }}>
                              {it.title}
                            </Link>
                          </div>

                          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                            專案：{projectName(it.project_id)} · 嚴重度：
                            {it.severity === 1 ? "高" : it.severity === 2 ? "中" : "低"} · 狀態：
                            {it.status === "open" ? "未處理" : it.status === "doing" ? "處理中" : "完成"}
                          </div>

                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                            負責人：{it.assignee?.name ?? "（未指派）"}
                          </div>

                          {it.description && <div style={{ marginTop: 8, opacity: 0.9, whiteSpace: "pre-wrap" }}>{it.description}</div>}

                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>
                            建立：{new Date(it.created_at).toLocaleString()} · 更新：{new Date(it.updated_at).toLocaleString()}
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 8, minWidth: 210 }}>
                          <button
                            onClick={() => assignToMe(it.id)}
                            style={{ padding: "8px 10px", cursor: "pointer", borderRadius: 8 }}
                          >
                            指派給我
                          </button>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {(["open", "doing", "done"] as const).map((s) => {
                              const active = it.status === s;
                              return (
                                <button
                                  key={s}
                                  onClick={() => setIssueStatus(it.id, s)}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 999,
                                    cursor: "pointer",
                                    border: active ? "1px solid #2563eb" : "1px solid #ddd",
                                    background: active ? "#2563eb" : "#fff",
                                    color: active ? "#fff" : "#111",
                                    fontSize: 12,
                                    fontWeight: 900,
                                  }}
                                >
                                  {s === "open" ? "未處理" : s === "doing" ? "處理中" : "完成"}
                                </button>
                              );
                            })}
                          </div>

                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button
                              onClick={() => openEdit(it)}
                              style={{ padding: "8px 10px", cursor: "pointer", borderRadius: 8 }}
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => deleteIssue(it.id)}
                              style={{ padding: "8px 10px", cursor: "pointer", borderRadius: 8, border: "1px solid #fca5a5" }}
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>id: {it.id}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ✅ 編輯 Modal */}
        {editOpen && (
          <div style={modalOverlay} onClick={() => !saving && setEditOpen(false)}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>編輯 Issue</div>
                <button onClick={() => !saving && setEditOpen(false)} style={{ padding: "6px 10px", cursor: "pointer" }}>
                  關閉
                </button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <div>
                  <div style={label}>標題</div>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={input}
                    disabled={saving}
                    placeholder="請輸入標題"
                  />
                </div>

                <div>
                  <div style={label}>描述</div>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    style={{ ...input, height: 110, resize: "vertical" }}
                    disabled={saving}
                    placeholder="可多行"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={label}>嚴重度</div>
                    <select
                      value={String(editSeverity)}
                      onChange={(e) => setEditSeverity(clampSeverity(Number(e.target.value)))}
                      style={input}
                      disabled={saving}
                    >
                      <option value="1">高</option>
                      <option value="2">中</option>
                      <option value="3">低</option>
                    </select>
                  </div>

                  <div>
                    <div style={label}>狀態</div>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as any)}
                      style={input}
                      disabled={saving}
                    >
                      <option value="open">未處理</option>
                      <option value="doing">處理中</option>
                      <option value="done">完成</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={saveEdit} disabled={saving} style={{ padding: "10px 14px", cursor: "pointer", borderRadius: 8 }}>
                    {saving ? "儲存中..." : "儲存"}
                  </button>
                </div>

                <div style={{ fontSize: 12, opacity: 0.7 }}>備註：刪除/更新若被擋，代表 RLS 權限正常生效。</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modalCard: React.CSSProperties = {
  width: "min(780px, 100%)",
  background: "#fff",
  borderRadius: 14,
  padding: 14,
  border: "1px solid #eee",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  outline: "none",
};

const label: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.75,
  marginBottom: 6,
  fontWeight: 800,
};
