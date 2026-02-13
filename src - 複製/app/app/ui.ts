// src/app/app/ui.ts
export function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function startOfWeekMon(d: Date) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function weekdayLabel(i: number) {
  return ["一", "二", "三", "四", "五", "六", "日"][i] ?? "";
}

export const ui = {
  shell: {
    display: "flex",
  } as React.CSSProperties,

  content: {
    flex: 1,
    padding: 18,
    fontFamily: "sans-serif",
  } as React.CSSProperties,

  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
  } as React.CSSProperties,

  title: {
    fontWeight: 900,
    fontSize: 18,
  } as React.CSSProperties,

  subtitle: {
    marginTop: 6,
    fontSize: 12,
    opacity: 0.75,
  } as React.CSSProperties,

  btn: {
    padding: "6px 10px",
    cursor: "pointer",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: "#fff",
  } as React.CSSProperties,

  card: {
    border: "1px solid #000",
    borderRadius: 12,
    padding: 14,
    background: "#fff",
  } as React.CSSProperties,

  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  } as React.CSSProperties,

  linkBtn: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid #ddd",
    textDecoration: "none",
    color: "#111",
    fontWeight: 800,
    fontSize: 12,
    background: "#fff",
  } as React.CSSProperties,

  row: {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: 10,
    background: "#fff",
  } as React.CSSProperties,

  table: {
    borderCollapse: "collapse",
    minWidth: 1200,
    width: "100%",
  } as React.CSSProperties,

  th: {
    border: "1px solid #000",
    padding: 10,
    background: "#ffe766",
    textAlign: "center",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  } as React.CSSProperties,

  tdLeft: {
    border: "1px solid #000",
    padding: 10,
    background: "#fff",
    fontWeight: 900,
    width: 150,
    whiteSpace: "nowrap",
    verticalAlign: "top",
  } as React.CSSProperties,

  tdCell: {
    border: "1px solid #000",
    padding: 10,
    verticalAlign: "top",
    minWidth: 150,
  } as React.CSSProperties,

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  } as React.CSSProperties,

  modalCard: {
    width: "min(820px, 100%)",
    background: "#fff",
    borderRadius: 14,
    padding: 14,
    border: "1px solid #eee",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #ddd",
    outline: "none",
  } as React.CSSProperties,

  label: {
    fontSize: 12,
    opacity: 0.75,
    marginBottom: 6,
    fontWeight: 800,
  } as React.CSSProperties,
};
