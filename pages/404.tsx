// pages/404.tsx
// This overrides the default Next.js 404 page
// and prevents the Html import error during build

export default function Custom404() {
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
      <h1 style={{ fontSize: "4rem", fontWeight: "700", color: "#6366f1", marginBottom: "1rem" }}>
        404
      </h1>
      <p style={{ color: "#8888aa", marginBottom: "2rem" }}>Page not found</p>
      <a 
        href="/dashboard" 
        style={{ 
          background: "#6366f1", 
          color: "white", 
          padding: "0.5rem 1.5rem", 
          borderRadius: "0.5rem",
          textDecoration: "none"
        }}
      >
        Go to Dashboard
      </a>
    </div>
  );
}