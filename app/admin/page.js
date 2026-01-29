"use client";

import { useEffect, useMemo, useState } from "react";

const MESSAGES = {
  en: {
    title: "Admin Codes",
    subtitle: "Live list of recent codes for all recipients.",
    statusSearching: "Scanning inbox...",
    statusWaiting: "Waiting for new codes...",
    statusError: "Unable to reach the server.",
    statusUnauthorized: "Unauthorized. Check your password.",
    resultsTitle: "All Results",
    emptyDefault: "No codes found in the lookback window."
  },
  ar: {
    title: "لوحة الأكواد",
    subtitle: "قائمة مباشرة بالرموز الحديثة لكل المستلمين.",
    statusSearching: "جارٍ فحص البريد...",
    statusWaiting: "بانتظار رموز جديدة...",
    statusError: "تعذر الاتصال بالخادم.",
    statusUnauthorized: "غير مصرح. تحقق من كلمة المرور.",
    resultsTitle: "كل النتائج",
    emptyDefault: "لا توجد رموز ضمن المدة المحددة."
  }
};

function itemTimestamp(item) {
  if (item.timestamp) {
    return Number(item.timestamp) * 1000;
  }
  if (item.time) {
    const parsed = Date.parse(item.time);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function minutesAgo(value) {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  const diffMs = Date.now() - time;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  return minutes;
}

export default function AdminPage() {
  const [lang, setLang] = useState("en");
  const [status, setStatus] = useState(MESSAGES.en.statusSearching);
  const [statusType, setStatusType] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [items, setItems] = useState([]);
  const [password, setPassword] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const currentLang = MESSAGES[lang] || MESSAGES.en;
  const locale = lang === "ar" ? "ar" : "en";

  const statusClass = useMemo(() => {
    if (!statusType) {
      return "status";
    }
    return `status ${statusType}`;
  }, [statusType]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!authorized) {
        return;
      }
      setStatusType("");
      setStatus(currentLang.statusSearching);
      try {
        const response = await fetch("/api/admin/codes");
        const data = await response.json();
        if (!active) {
          return;
        }
        if (!response.ok) {
          setStatusType("error");
          setStatus(
            response.status === 401
              ? currentLang.statusUnauthorized
              : data.error || currentLang.statusError
          );
          setAuthorized(false);
          return;
        }
        const sortedItems = (data.items || [])
          .slice()
          .sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
        setItems(sortedItems);
        setCheckedAt(data.checkedAt || "");
        setStatusType("success");
        setStatus(currentLang.statusWaiting);
      } catch {
        if (!active) {
          return;
        }
        setStatusType("error");
        setStatus(currentLang.statusError);
      }
    }

    load();
    const timer = setInterval(load, 8000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [authorized, currentLang.statusError, currentLang.statusSearching, currentLang.statusWaiting]);

  function handleUnlock(event) {
    event.preventDefault();
    if (!password.trim()) {
      return;
    }
    setStatusType("");
    setStatus(currentLang.statusSearching);
    fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unauthorized");
        }
        setAuthorized(true);
        setStatusType("success");
        setStatus(currentLang.statusWaiting);
      })
      .catch(() => {
        setStatusType("error");
        setStatus(currentLang.statusUnauthorized);
        setAuthorized(false);
      });
  }

  useEffect(() => {
    let active = true;
    async function checkSession() {
      try {
        const response = await fetch("/api/admin/codes");
        if (!active) {
          return;
        }
        if (response.ok) {
          setAuthorized(true);
          setStatusType("success");
          setStatus(currentLang.statusWaiting);
        } else {
          setAuthorized(false);
        }
      } catch {
        if (!active) {
          return;
        }
        setAuthorized(false);
      }
    }
    checkSession();
    return () => {
      active = false;
    };
  }, [currentLang.statusWaiting]);

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="ambient">
        <div className="halo"></div>
        <div className="ribbon"></div>
      </div>

      <main className="page">
        <header className="hero">
          <div className="hero-top">
            <div className="badge">Admin</div>
            <button
              type="button"
              className="lang-toggle"
              onClick={() => setLang((prev) => (prev === "en" ? "ar" : "en"))}
            >
              {lang === "ar" ? "English" : "العربية"}
            </button>
          </div>
          <h1>{currentLang.title}</h1>
          <p>{currentLang.subtitle}</p>
        </header>

        <section className="card">
          {!authorized ? (
            <form className="form" onSubmit={handleUnlock}>
              <label htmlFor="admin-password">
                {lang === "ar" ? "كلمة مرور المسؤول" : "Admin password"}
              </label>
              <input
                id="admin-password"
                name="admin-password"
                type="password"
                placeholder={lang === "ar" ? "أدخل كلمة المرور" : "Enter password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button type="submit" className="primary-button">
                {lang === "ar" ? "دخول" : "Unlock"}
              </button>
              <div className={statusClass}>{status}</div>
            </form>
          ) : (
            <div className={statusClass}>{status}</div>
          )}

          <div className="results">
            <div className="results-header">
              <span>{currentLang.resultsTitle}</span>
              <span>
                {checkedAt
                  ? `${lang === "ar" ? "تم الفحص في" : "Checked at"} ${new Date(
                      checkedAt
                    ).toLocaleTimeString(locale)}`
                  : ""}
              </span>
            </div>
            <div className="result-content">
              {items.length === 0 ? (
                <div>{currentLang.emptyDefault}</div>
              ) : (
                <div className="result-list">
                  {items.map((item, index) => (
                    <div className="result-row" key={`${item.code}-${index}`}>
                      <div className="result-meta">
                        {item.time ? (
                          <span title={new Date(item.time).toLocaleString(locale)}>
                            {lang === "ar"
                              ? `منذ ${minutesAgo(item.time) ?? 0} دقيقة`
                              : `${minutesAgo(item.time) ?? 0} minutes ago`}
                          </span>
                        ) : (
                          <span>{lang === "ar" ? "وقت غير معروف" : "Unknown time"}</span>
                        )}{" "}
                        | {item.to || (lang === "ar" ? "مستلم غير معروف" : "Unknown recipient")}
                      </div>
                      <div className="result-code">{item.code}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
