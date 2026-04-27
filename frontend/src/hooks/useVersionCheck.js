import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const currentVersion = useRef(null);

  useEffect(() => {
    let timer;

    async function check() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const { version } = await res.json();
        if (currentVersion.current === null) {
          currentVersion.current = version;
        } else if (version !== currentVersion.current) {
          setUpdateAvailable(true);
        }
      } catch {
        // network error — ignore
      }
    }

    check();
    timer = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return updateAvailable;
}
