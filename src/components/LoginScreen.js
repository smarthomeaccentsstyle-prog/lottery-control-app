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
    <div className="login-shell">
      <div className="login-card">
        <div className="login-kicker">{isAdmin ? "Admin Access" : "Seller Access"}</div>
        <h1>{isAdmin ? "Admin Login" : "Seller Panel Login"}</h1>

        <p className="login-copy">
          {isAdmin
            ? "Enter admin username and password to open the risk board."
            : "Enter seller username and password to continue selling tickets from any device."}
        </p>

        <div className="login-role-toggle">
          <button
            type="button"
            className={`login-role-btn ${!isAdmin ? "active" : ""}`}
            onClick={() => setRole("seller")}
          >
            Seller
          </button>
          <button
            type="button"
            className={`login-role-btn ${isAdmin ? "active" : ""}`}
            onClick={() => setRole("admin")}
          >
            Admin
          </button>
        </div>

        <form
          className="login-field-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onLogin();
          }}
        >
          <input
            placeholder={isAdmin ? "Admin Username" : "Seller Username"}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />

          <button
            type="submit"
            className="login-submit-btn"
            disabled={loading}
          >
            {loading ? "Checking..." : "Login"}
          </button>
        </form>

        {statusMessage ? (
          <div className="login-status">{statusMessage}</div>
        ) : null}

        <div className="login-demo">
          {isAdmin ? "Demo: admin / 1234" : "Demo: seller1 / 1234"}
        </div>
      </div>
    </div>
  );
}
