
import { useEffect, useState } from "react";

function App() {
  const [message, setMessage] = useState("Connecting...");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch("/api/public/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Backend unavailable");
        }
        return response.json();
      })
      .then((data) => {
        setMessage(data.message);
        setConnected(true);
      })
      .catch(() => {
        setMessage("Unable to connect to Spring Boot");
        setConnected(false);
      });
  }, []);

  return (
    <main className="welcome">
      <section className="welcome-card">
        <div className="logo">H</div>

        <h1>HARUHAY</h1>

        <p className="subtitle">
          Your Boarding Community, Connected.
        </p>

        <div
          className={
            connected ? "status connected" : "status"
          }
        >
          {connected ? "● Backend Connected" : "○ Disconnected"}
        </div>

        <p className="message">{message}</p>

        <p className="footer">
          Boarding House Management Platform
        </p>
      </section>
    </main>
  );
}

export default App;
