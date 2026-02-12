"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../Sidebar";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type ProjectRow = { id: string; name: string };

type ValidationRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
};

export default function ValidationsPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("");

  const [projects, setProjects] = useState<ProjectRow[]>([]);

  // ✅ 兩層式：先選專案
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  // list
  const [rows, setRows] = useState<ValidationRow[]>([]);

  // create form (綁在 selectedProjectId)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // download state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return (id: string) => m.get(id) ?? "（未知專案）";
  }, [projects]);

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

  async function loadValidations(projectId: string) {
    const { data, error } = await supabase
      .from("validations")
      .select("id,project_id,title,description,file_path,file_name,file_type,file_size,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    setRows((data ?? []) as ValidationRow[]);
  }

  async function refreshAll() {
    setMsg("");
    try {
      await ensureLoggedIn();
      await loadProjects();
      if (selectedProjectId) await loadValidations(selectedProjectId);
      else setRows([]);
    } catch (e: any) {
      setMsg("❌ " + (e?.message ?? "unknown"));
    }
  }

  async function selectProject(projectId: string) {
    setMsg("");
    setSelectedProjectId(projectId);
    setRows([]);
    try {
      await ensureLoggedIn();
      await loadValidations(projectId);
    } catch (e: any) {
      setMsg("❌ 讀取資料失敗：" + (e?.message ?? "unknown"));
    }
  }

  function safeFileName(original: string) {
    return original.replace(/[^\w.\-]+/g, "_");
  }

  async function upload() {
    setMsg("");

    try {
      const user = await ensureLoggedIn();

      if (!selectedProjectId) return setMsg("請先選擇專案");
      if (!title.trim()) return setMsg("請輸入驗證名稱");
      if (!file) return setMsg("請選擇檔案");

      setUploading(true);

      const ts = Date.now();
      const cleaned = safeFileName(file.name);
      const path = `${selectedProjectId}/${ts}_${cleaned}`;

      const { error: upErr } = await supabase.storage.from("validations").upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("validations").insert({
        project_id: selectedProjectId,
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        file_path: path,
        file_name: file.name,
        file_type: file.type || null,
        file_size: file.size ?? null,
        uploaded_by: user.id,
      });
      if (insErr) throw insErr;

      setTitle("");
      setDescription("");
      setFile(null);

      await loadValidations(selectedProjectId);
      setMsg("✅ 上傳完成");
    } catch (e: any) {
      setMsg("❌ 上傳失敗：" + (e?.message ?? "unknown"));
    } finally {
      setUploading(false);
    }
  }

  async function downloadSigned(row: ValidationRow) {
    setMsg("");
    try {
      await ensureLoggedIn();
      setDownloadingId(row.id);

      const { data, error } = await supabase.storage.from("validations").createSignedUrl(row.file_path, 60);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error("signedUrl 取得失敗");

      window.open(data.signedUrl, "_blank", "noreferrer");
    } catch (e: any) {
      setMsg("❌ 下載失敗：" + (e?.message ?? "unknown"));
    } finally {
      setDownloadingId(null);
    }
  }

  async function removeOne(row: ValidationRow) {
    setMsg("");
    const ok = confirm(`確定要刪除「${row.title}」嗎？\n（會同時刪除檔案與資料）`);
    if (!ok) return;

    try {
      await ensureLoggedIn();
      setDeletingId(row.id);

      const { error: storErr } = await supabase.storage.from("validations").remove([row.file_path]);
      if (storErr) throw storErr;

      const { error: dbErr } = await supabase.from("validations").delete().eq("id", row.id);
      if (dbErr) throw dbErr;

      if (selectedProjectId) await loadValidations(selectedProjectId);
      setMsg("✅ 已刪除");
    } catch (e: any) {
      setMsg("❌ 刪除失敗：" + (e?.message ?? "unknown"));
    } finally {
      setDeletingId(null);
    }
  }

  function openEdit(row: ValidationRow) {
    setEditingId(row.id);
    setEditTitle(row.title ?? "");
    setEditDesc(row.description ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    setMsg("");
    if (!editingId) return;
    if (!editTitle.trim()) return setMsg("請輸入驗證名稱");

    setSaving(true);
    try {
      await ensureLoggedIn();

      const { error } = await supabase
        .from("validations")
        .update({
          title: editTitle.trim(),
          description: editDesc.trim() ? editDesc.trim() : null,
        })
        .eq("id", editingId);

      if (error) throw error;

      setEditOpen(false);
      if (selectedProjectId) await loadValidations(selectedProjectId);
      setMsg("✅ 已更新");
    } catch (e: any) {
      setMsg("❌ 更新失敗：" + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />

      <div style={{ flex: 1, padding: 18, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>專案驗證數據（Private + Signed URL）</div>
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              {selectedProjectId ? `目前專案：${projectName(selectedProjectId)}` : "請先選擇專案"}
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
                    <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>點擊查看/管理驗證資料</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 返回專案列表 */}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => {
                  setSelectedProjectId("");
                  setRows([]);
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

            {/* ✅ Step 2：新增驗證資料（不再選專案） */}
            <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 900 }}>新增驗證資料（上傳檔案）</div>

              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="驗證名稱（必填）"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="說明（可選）"
                  rows={3}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />

                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />

                <button
                  onClick={upload}
                  disabled={uploading}
                  style={{
                    padding: "10px 14px",
                    cursor: uploading ? "not-allowed" : "pointer",
                    borderRadius: 8,
                    opacity: uploading ? 0.6 : 1,
                  }}
                >
                  {uploading ? "上傳中..." : "上傳"}
                </button>

                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  提醒：編輯功能只更新「名稱/說明」，不替換檔案；若要換檔，建議重新上傳一筆再刪舊的。
                </div>
              </div>
            </div>

            {/* ✅ Step 3：列表 */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontWeight: 900 }}>驗證資料列表</div>

              {rows.length === 0 ? (
                <p style={{ marginTop: 10 }}>目前沒有資料</p>
              ) : (
                <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                  {rows.map((r) => {
                    const isDeleting = deletingId === r.id;
                    const isDownloading = downloadingId === r.id;

                    return (
                      <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 900 }}>{r.title}</div>

                            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                              專案：{projectName(r.project_id)} · 檔名：{r.file_name}
                            </div>

                            {r.description && <div style={{ marginTop: 8, opacity: 0.9, whiteSpace: "pre-wrap" }}>{r.description}</div>}

                            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>
                              {new Date(r.created_at).toLocaleString()} · {r.file_type ?? "-"} ·{" "}
                              {r.file_size ? `${Math.round(r.file_size / 1024)} KB` : "-"}
                            </div>
                          </div>

                          <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
                            <button
                              onClick={() => downloadSigned(r)}
                              disabled={isDownloading}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 8,
                                cursor: isDownloading ? "not-allowed" : "pointer",
                                opacity: isDownloading ? 0.6 : 1,
                                fontWeight: 900,
                              }}
                            >
                              {isDownloading ? "產生下載連結..." : "下載/開啟（Signed）"}
                            </button>

                            <button
                              onClick={() => openEdit(r)}
                              style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer" }}
                            >
                              編輯
                            </button>

                            <button
                              onClick={() => removeOne(r)}
                              disabled={isDeleting}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 8,
                                cursor: isDeleting ? "not-allowed" : "pointer",
                                opacity: isDeleting ? 0.6 : 1,
                              }}
                            >
                              {isDeleting ? "刪除中..." : "刪除"}
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>id: {r.id}</div>
                      </div>
                    );
                  })}
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
                <div style={{ fontWeight: 900, fontSize: 16 }}>編輯驗證資料</div>
                <button onClick={() => !saving && setEditOpen(false)} style={{ padding: "6px 10px", cursor: "pointer" }}>
                  關閉
                </button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <div>
                  <div style={label}>驗證名稱</div>
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={input}
                    disabled={saving}
                    placeholder="請輸入驗證名稱"
                  />
                </div>

                <div>
                  <div style={label}>說明</div>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    style={{ ...input, height: 110, resize: "vertical" }}
                    disabled={saving}
                    placeholder="可多行"
                  />
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    style={{ padding: "10px 14px", cursor: "pointer", borderRadius: 8 }}
                  >
                    {saving ? "儲存中..." : "儲存"}
                  </button>
                </div>

                <div style={{ fontSize: 12, opacity: 0.7 }}>備註：更新若被擋，代表 RLS 權限正常生效。</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // --- local ---
  async function saveEditInternal() {
    setMsg("");
    if (!editingId) return;
    if (!editTitle.trim()) return setMsg("請輸入驗證名稱");

    setSaving(true);
    try {
      await ensureLoggedIn();

      const { error } = await supabase
        .from("validations")
        .update({
          title: editTitle.trim(),
          description: editDesc.trim() ? editDesc.trim() : null,
        })
        .eq("id", editingId);

      if (error) throw error;

      setEditOpen(false);
      if (selectedProjectId) await loadValidations(selectedProjectId);
      setMsg("✅ 已更新");
    } catch (e: any) {
      setMsg("❌ 更新失敗：" + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
  }
}

// 這裡沿用你原本風格的簡單 modal style
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
