import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";

const STORAGE_KEY = "seller-panel-state-v3";

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
      localStorage.removeItem(STORAGE_KEY);
    } catch {}

    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div style={fallbackStyles.page}>
          <div style={fallbackStyles.card}>
            <h1 style={fallbackStyles.title}>Seller Panel Could Not Open</h1>
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
      "radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 28%), linear-gradient(180deg, #080d18 0%, #0c1322 100%)",
    color: "#eef4ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    width: "100%",
    maxWidth: "560px",
    padding: "28px",
    borderRadius: "24px",
    background: "rgba(18, 25, 39, 0.94)",
    border: "1px solid rgba(29, 40, 64, 0.92)",
    boxShadow: "0 18px 36px rgba(0, 0, 0, 0.2)",
  },
  title: {
    margin: "0 0 12px",
    fontSize: "32px",
    lineHeight: 1.1,
  },
  text: {
    margin: "0 0 12px",
    color: "#b8c4db",
    lineHeight: 1.6,
  },
  button: {
    marginTop: "12px",
    minHeight: "46px",
    padding: "12px 18px",
    borderRadius: "14px",
    border: "1px solid transparent",
    background: "linear-gradient(135deg, #2d63ea, #3b82f6)",
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
