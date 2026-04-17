import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import {
  PANEL_SESSION_KEY,
  SELLER_LIST_KEY,
  SELLER_PANEL_STORAGE_KEY,
} from "./untils/adminStorage";

const STARTUP_RESET_KEYS = [
  SELLER_PANEL_STORAGE_KEY,
  PANEL_SESSION_KEY,
  SELLER_LIST_KEY,
];

class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  handleReset = () => {
    try {
      STARTUP_RESET_KEYS.forEach((key) => {
        localStorage.removeItem(key);
      });
    } catch {}

    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div style={fallbackStyles.page}>
          <div style={fallbackStyles.card}>
            <h1 style={fallbackStyles.title}>TicketFlow X Could Not Open</h1>
            <p style={fallbackStyles.text}>
              The app hit a startup error. This is often caused by old local browser data from a previous version.
            </p>
            <p style={fallbackStyles.text}>
              Error: {(this.state.error && this.state.error.message) || "Unknown startup error"}
            </p>
            <button style={fallbackStyles.button} onClick={this.handleReset}>
              Clear Local Data And Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const fallbackStyles = {
  page: {
    minHeight: "100vh",
    margin: 0,
    padding: "24px",
    background:
      "radial-gradient(circle at top left, rgba(59, 130, 246, 0.18), transparent 24%), radial-gradient(circle at top right, rgba(245, 200, 66, 0.14), transparent 28%), linear-gradient(180deg, #0b0b0f 0%, #12121a 100%)",
    color: "#f7f8fb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: '"Avenir Next", "Segoe UI", system-ui, sans-serif',
  },
  card: {
    width: "100%",
    maxWidth: "560px",
    padding: "28px",
    borderRadius: "24px",
    background:
      "radial-gradient(circle at top right, rgba(245, 200, 66, 0.16), transparent 28%), radial-gradient(circle at bottom left, rgba(59, 130, 246, 0.16), transparent 34%), linear-gradient(180deg, rgba(20, 24, 35, 0.99), rgba(10, 12, 18, 0.99))",
    border: "1px solid rgba(66, 82, 114, 0.38)",
    boxShadow: "0 22px 48px rgba(0, 0, 0, 0.34)",
  },
  title: {
    margin: "0 0 12px",
    fontSize: "32px",
    lineHeight: 1.1,
  },
  text: {
    margin: "0 0 12px",
    color: "#98a3b8",
    lineHeight: 1.6,
  },
  button: {
    marginTop: "12px",
    minHeight: "46px",
    padding: "12px 18px",
    borderRadius: "14px",
    border: "1px solid transparent",
    background: "linear-gradient(135deg, #1f5ed8 0%, #3b82f6 56%, #f5c842 100%)",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
  },
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
