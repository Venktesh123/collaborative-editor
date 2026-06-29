// pages/500.tsx
export default function Custom500() {
  return (
    <div style={{ 
      minHeight: "100vh", 
      display: "flex", 
      flexDirection: "column",
      alignItems: "center", 
      justifyContent: "center",
      background: "#0a0a0f",
      color: "#e2e2f0",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1 style={{ fontSize: "4rem", fontWeight: "700", color: "#ef4444", marginBottom: "1rem" }}>
        500
      </h1>
      <p style={{ color: "#8888aa", marginBottom: "2rem" }}>Something went wrong</p>
      <a 
        href="/" 
        style={{ 
          background: "#6366f1", 
          color: "white", 
          padding: "0.5rem 1.5rem", 
          borderRadius: "0.5rem",
          textDecoration: "none"
        }}
      >
        Go Home
      </a>
    </div>
  );
}