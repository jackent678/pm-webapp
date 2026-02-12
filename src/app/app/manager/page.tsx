"use client";
import Sidebar from "../Sidebar";

export default function ManagerPage() {
  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <div style={{ flex: 1, padding: 18 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>主管專區</div>
        <p style={{ marginTop: 10 }}>（下一步：主管看板、待審核、KPI）</p>
      </div>
    </div>
  );
}
