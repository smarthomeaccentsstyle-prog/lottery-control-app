export default function LoginScreen({
  role,
  username,
  setUsername,
  password,
  setPassword,
  onLogin,
  onRetry,
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
            disabled={loading}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={loading}
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
          <div className="login-status">
            <span>{statusMessage}</span>
            {onRetry ? (
              <button
                type="button"
                className="outline-btn login-retry-btn"
                onClick={onRetry}
                disabled={loading}
              >
                {loading ? "Checking..." : "Retry"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
