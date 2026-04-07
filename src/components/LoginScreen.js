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
  const isMaster = role === "master";
  const accessLabel = isMaster ? "Master Access" : isAdmin ? "Admin Access" : "Seller Access";
  const title = isMaster ? "Master Panel Login" : isAdmin ? "Admin Login" : "Seller Panel Login";
  const copy = isMaster
    ? "Enter master username and password to control admin and seller accounts only."
    : isAdmin
      ? "Enter admin username and password to open the risk board."
      : "Enter seller username and password to continue selling tickets from any device.";
  const usernamePlaceholder = isMaster
    ? "Master Username"
    : isAdmin
      ? "Admin Username"
      : "Seller Username";

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-kicker">{accessLabel}</div>
        <h1>{title}</h1>

        <p className="login-copy">{copy}</p>

        <form
          className="login-field-grid"
          onSubmit={(event) => {
            event.preventDefault();
            onLogin();
          }}
        >
          <input
            placeholder={usernamePlaceholder}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            disabled={loading}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="current-password"
            spellCheck={false}
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
