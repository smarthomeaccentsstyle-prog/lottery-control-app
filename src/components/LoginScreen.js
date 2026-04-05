export default function LoginScreen({
  role,
  setRole,
  username,
  setUsername,
  password,
  setPassword,
  onLogin,
  loading = false,
  statusMessage = "",
}) {
  const isAdmin = role === "admin";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020617",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#111827",
          border: "1px solid #263041",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          color: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <button
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #334155",
              background: !isAdmin ? "#2563eb" : "#0f172a",
              color: "#fff",
              cursor: "pointer",
            }}
            onClick={() => setRole("seller")}
          >
            Seller
          </button>
          <button
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #334155",
              background: isAdmin ? "#2563eb" : "#0f172a",
              color: "#fff",
              cursor: "pointer",
            }}
            onClick={() => setRole("admin")}
          >
            Admin
          </button>
        </div>

        <h2 style={{ marginTop: 0 }}>{isAdmin ? "Admin Login" : "Seller Panel Login"}</h2>

        <p style={{ color: "#94a3b8", marginBottom: 18 }}>
          {isAdmin
            ? "Enter admin username and password to open the risk board"
            : "Enter seller username and password to continue"}
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#f8fafc",
              outline: "none",
              fontSize: 14,
            }}
            placeholder={isAdmin ? "Admin Username" : "Seller Username"}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <input
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 12,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#f8fafc",
              outline: "none",
              fontSize: 14,
            }}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button
            style={{
              padding: "12px",
              borderRadius: 12,
              fontWeight: 700,
              border: "none",
              cursor: "pointer",
              background: "#2563eb",
              color: "#fff",
              marginTop: 6,
              opacity: loading ? 0.75 : 1,
            }}
            disabled={loading}
            onClick={onLogin}
          >
            {loading ? "Checking..." : "Login"}
          </button>
        </div>

        {statusMessage ? (
          <div
            style={{
              marginTop: 14,
              fontSize: 12,
              color: "#94a3b8",
              lineHeight: 1.6,
            }}
          >
            {statusMessage}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 16,
            fontSize: 12,
            color: "#64748b",
          }}
        >
          {isAdmin ? "Demo: admin / 1234" : "Demo: seller1 / 1234"}
        </div>
      </div>
    </div>
  );
}
