"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const MESSAGES = {
  en: {
    badge: "Made By ServiceHub",
    title: "Email Code Receiver :)",
    subtitle: "Get Code From last 5 munites For ChatGPT & Other Services",
    cardTitle: "Get Your Verification Code",
    cardSubtitle: "Add Your Mail to get Code",
    notice: "Valid for 5-8 munites only",
    labelEmail: "Recipient Email Address",
    placeholderEmail: "user@example.com",
    statusChecking: "Checking IMAP credentials...",
    statusReady: "IMAP connected. Ready to search.",
    statusNotReady: "IMAP not configured.",
    statusAuthFail: "Unable to check authentication status.",
    statusSearching: "Searching the lookback window...",
    statusWaiting: "Waiting for new codes...",
    statusSuccess: "Codes retrieved.",
    statusServerError: "Unable to reach the server.",
    resultsTitle: "Results",
    emptyDefault: "Enter an email to search in the Gmail inbox you authorized.",
    emptyNoCodes: "No codes found in the lookback window.",
    footer: "Thank you for Using our Service :)",
    langLabel: "العربية"
  },
  ar: {
    badge: "صنع بواسطة ServiceHub",
    title: "مستقبل رموز البريد :)",
    subtitle: "احصل على الرمز خلال آخر 5 دقائق لـ ChatGPT وخدمات أخرى",
    cardTitle: "احصل على رمز التحقق",
    cardSubtitle: "أدخل بريدك للحصول على الرمز",
    notice: "صالحة لمدة 5-8 دقائق فقط",
    labelEmail: "البريد الإلكتروني للمستلم",
    placeholderEmail: "user@example.com",
    statusChecking: "جارٍ التحقق من بيانات IMAP...",
    statusReady: "تم الاتصال بـ IMAP. جاهز للبحث.",
    statusNotReady: "IMAP غير مُعد.",
    statusAuthFail: "تعذر التحقق من حالة المصادقة.",
    statusSearching: "جارٍ البحث ضمن المدة المحددة...",
    statusWaiting: "بانتظار رموز جديدة...",
    statusSuccess: "تم جلب الرموز.",
    statusServerError: "تعذر الاتصال بالخادم.",
    resultsTitle: "النتائج",
    emptyDefault: "أدخل بريدًا للبحث داخل صندوق البريد المصرح به.",
    emptyNoCodes: "لا توجد رموز ضمن المدة المحددة.",
    footer: "شكرًا لاستخدام خدمتنا :)",
    langLabel: "English"
  }
};

function formatCheckedAt(value, locale) {
  if (!value) {
    return "";
  }
  try {
    return new Date(value).toLocaleTimeString(locale);
  } catch {
    return "";
  }
}

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

export default function HomePage() {
  const [lang, setLang] = useState("en");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(MESSAGES.en.statusChecking);
  const [statusType, setStatusType] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [items, setItems] = useState([]);
  const [emptyMessage, setEmptyMessage] = useState(MESSAGES.en.emptyDefault);
  const pollRef = useRef(null);
  const latestItemsRef = useRef([]);
  const currentLang = MESSAGES[lang] || MESSAGES.en;
  const locale = lang === "ar" ? "ar" : "en";

  useEffect(() => {
    if (status === MESSAGES.en.statusChecking || status === MESSAGES.ar.statusChecking) {
      setStatus(currentLang.statusChecking);
    }
  }, [currentLang.statusChecking, status]);

  const statusClass = useMemo(() => {
    if (!statusType) {
      return "status";
    }
    return `status ${statusType}`;
  }, [statusType]);

  useEffect(() => {
    let isMounted = true;
    async function refreshAuthStatus() {
      try {
        const response = await fetch("/api/auth/status");
        const data = await response.json();
        if (!isMounted) {
          return;
        }
        if (data.authenticated) {
          setStatusType("success");
          setStatus(data.message || currentLang.statusReady);
        } else {
          setStatusType("error");
          setStatus(data.message || currentLang.statusNotReady);
        }
      } catch {
        if (!isMounted) {
          return;
        }
        setStatusType("error");
        setStatus(currentLang.statusAuthFail);
      }
    }

    refreshAuthStatus();
    return () => {
      isMounted = false;
    };
  }, [currentLang.statusAuthFail, currentLang.statusNotReady, currentLang.statusReady]);

  function updateItems(data) {
      const sortedItems = (data.items || [])
        .slice()
        .sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
      latestItemsRef.current = sortedItems;
      setItems(sortedItems);
    if (!sortedItems.length) {
      setEmptyMessage(currentLang.emptyNoCodes);
    }
  }

  async function fetchCodes({ reset = false } = {}) {
    if (!email.trim()) {
      return;
    }
    if (reset) {
      setItems([]);
      latestItemsRef.current = [];
      setCheckedAt("");
      setEmptyMessage(currentLang.emptyDefault);
      setStatusType("");
      setStatus(currentLang.statusSearching);
    }
    try {
      const params = new URLSearchParams({ email: email.trim() });
      const response = await fetch(`/api/codes?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        setStatusType("error");
        setStatus(data.error || "Something went wrong.");
        return;
      }

      setStatusType("success");
      setStatus(currentLang.statusSuccess);
      setCheckedAt(data.checkedAt || "");
      updateItems(data);
      setStatus(currentLang.statusWaiting);
    } catch {
      setStatusType("error");
      setStatus(currentLang.statusServerError);
    }
  }

  useEffect(() => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setItems([]);
      latestItemsRef.current = [];
      setCheckedAt("");
      setEmptyMessage(currentLang.emptyDefault);
      return;
    }

    fetchCodes({ reset: true });
    if (!pollRef.current) {
      pollRef.current = setInterval(() => {
        fetchCodes();
      }, 8000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [email, currentLang.emptyDefault]);

  useEffect(() => {
    setEmptyMessage((message) =>
      message === MESSAGES.en.emptyDefault || message === MESSAGES.ar.emptyDefault
        ? currentLang.emptyDefault
        : message === MESSAGES.en.emptyNoCodes || message === MESSAGES.ar.emptyNoCodes
          ? currentLang.emptyNoCodes
          : message
    );
  }, [currentLang.emptyDefault, currentLang.emptyNoCodes]);

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="ambient">
        <div className="halo"></div>
        <div className="ribbon"></div>
      </div>

      <main className="page">
        <header className="hero">
          <div className="hero-top">
            <div className="badge">{currentLang.badge}</div>
            <button
              type="button"
              className="lang-toggle"
              onClick={() => setLang((prev) => (prev === "en" ? "ar" : "en"))}
            >
              {currentLang.langLabel}
            </button>
          </div>
          <h1>{currentLang.title}</h1>
          <p>{currentLang.subtitle}</p>
        </header>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>{currentLang.cardTitle}</h2>
              <p>{currentLang.cardSubtitle}</p>
              <p className="notice">{currentLang.notice}</p>
            </div>
          </div>

          <form className="form" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="email">{currentLang.labelEmail}</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder={currentLang.placeholderEmail}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div className={statusClass}>{status}</div>
          </form>

          <div className="results">
            <div className="results-header">
              <span>{currentLang.resultsTitle}</span>
              <span>{checkedAt ? `${lang === "ar" ? "تم الفحص في" : "Checked at"} ${formatCheckedAt(checkedAt, locale)}` : ""}</span>
            </div>
            <div className="result-content">
              {items.length === 0 ? (
                <div>{emptyMessage}</div>
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
                        | {item.from || (lang === "ar" ? "مرسل غير معروف" : "Unknown sender")}
                      </div>
                      <div className="result-code">{item.code}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <footer className="footer">{currentLang.footer}</footer>
      </main>

      <a
        className="whatsapp-fab"
        href="https://wa.me/201023684687"
        target="_blank"
        rel="noreferrer"
        aria-label={lang === "ar" ? "تواصل عبر واتساب" : "Contact via WhatsApp"}
      >
        <span className="whatsapp-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16.04 5.33c-5.87 0-10.65 4.78-10.65 10.66 0 1.88.49 3.72 1.42 5.34L5.2 26.8l5.64-1.48a10.6 10.6 0 0 0 5.2 1.37h.01c5.88 0 10.66-4.78 10.66-10.66 0-5.88-4.78-10.7-10.67-10.7Zm0 19.45h-.01a8.8 8.8 0 0 1-4.49-1.23l-.32-.19-3.35.88.9-3.27-.2-.34a8.9 8.9 0 0 1-1.35-4.72c0-4.91 4-8.9 8.92-8.9 4.9 0 8.9 4 8.9 8.91 0 4.91-3.99 8.86-8.9 8.86Zm4.83-6.62c-.26-.13-1.55-.76-1.79-.85-.24-.08-.42-.13-.6.13-.18.26-.69.85-.85 1.02-.16.18-.31.2-.57.07-.26-.13-1.1-.4-2.1-1.29-.78-.7-1.31-1.56-1.46-1.83-.15-.26-.02-.4.11-.53.12-.12.26-.31.39-.46.13-.16.18-.26.26-.44.09-.18.05-.33-.02-.46-.06-.13-.6-1.45-.82-1.98-.22-.53-.44-.46-.6-.46h-.52c-.18 0-.46.07-.7.33-.24.26-.92.9-.92 2.21 0 1.31.95 2.58 1.08 2.76.13.18 1.88 2.9 4.56 4.07.64.28 1.14.45 1.53.58.64.2 1.22.17 1.67.1.51-.07 1.55-.64 1.77-1.26.22-.62.22-1.16.15-1.26-.06-.1-.24-.16-.5-.29Z"
            />
          </svg>
        </span>
        <span className="whatsapp-text">{lang === "ar" ? "واتساب" : "WhatsApp"}</span>
      </a>
    </div>
  );
}
