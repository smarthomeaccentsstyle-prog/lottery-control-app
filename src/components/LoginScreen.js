import BrandMark from "./BrandMark.js";

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
  restoringSession = false,
  sessionLabel = "",
  maintenanceMode = false,
  maintenanceTitle = "Updating Server",
  maintenanceHint = "Refresh or reopen after update is complete.",
  retryLabel = "Retry",
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

  if (maintenanceMode) {
    return (
      <div className="login-shell">
        <div className="login-card maintenance-card">
          <BrandMark size="md" tagline="Fast, intelligent ticket operations" />
          <div className="login-kicker maintenance-kicker">{accessLabel}</div>
          <h1>{maintenanceTitle}</h1>
          <p className="login-copy">{statusMessage}</p>

          <div className="maintenance-status-panel" aria-live="polite">
            <div className="maintenance-pulse" aria-hidden="true" />
            <div>
              <strong>Server maintenance in progress</strong>
              <span>{maintenanceHint}</span>
            </div>
          </div>

          {onRetry ? (
            <div className="maintenance-action-bar">
              <span>Refresh or reopen after the update finishes.</span>
              <button
                type="button"
                className="outline-btn login-retry-btn"
                onClick={onRetry}
                disabled={loading}
              >
                {loading ? "Checking..." : retryLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (restoringSession) {
    return (
      <div className="login-shell">
        <div className="login-card session-restore-card">
          <BrandMark size="md" tagline="Fast, intelligent ticket operations" />
          <div className="login-kicker">{accessLabel}</div>
          <h1>Restoring Session</h1>
          <p className="login-copy">
            {sessionLabel
              ? `${sessionLabel} is being restored securely.`
              : "Checking your saved session securely."}
          </p>

          <div className="session-restore-status" aria-live="polite">
            <div className="session-restore-spinner" aria-hidden="true" />
            <div>
              <strong>Checking saved login...</strong>
              <span>Hold on for a moment.</span>
            </div>
          </div>

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
                  {loading ? "Checking..." : retryLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <BrandMark size="lg" tagline="Fast, intelligent ticket operations" />
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
                {loading ? "Checking..." : retryLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
