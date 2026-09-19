"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import Image from "next/image";
import { createPortal } from "react-dom";

const NotificationContext = createContext();

export function useNotify() {
  return useContext(NotificationContext);
}

export default function NotificationProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [confirmData, setConfirmData] = useState(null);

  const notify = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    const handler = (e) => notify(e.detail || "Gagal menyimpan data.", "error");
    window.addEventListener("dataError", handler);
    return () => window.removeEventListener("dataError", handler);
  }, [notify]);

  const confirmAsync = useCallback((message) => {
    return new Promise((resolve) => {
      setConfirmData({
        message,
        onYes: () => {
          setConfirmData(null);
          resolve(true);
        },
        onNo: () => {
          setConfirmData(null);
          resolve(false);
        },
      });
    });
  }, []);

  const confirmChoice = useCallback((message, choices) => {
    return new Promise((resolve) => {
      setConfirmData({
        message,
        choices,
        onChoice: (value) => {
          setConfirmData(null);
          resolve(value);
        },
        onNo: () => {
          setConfirmData(null);
          resolve(null);
        },
      });
    });
  }, []);

  const toastVariants = {
    success: "bg-green-50 border-green-200 text-green-800",
    error: "bg-red-50 border-red-200 text-red-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
    warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
  };

  const buttonBase =
    "rounded-md px-4 py-2 text-sm font-semibold transition-colors";
  const buttonPrimary = `${buttonBase} bg-brand text-white hover:bg-brand-strong`;
  const buttonGhost = `${buttonBase} text-text-secondary hover:bg-surface-secondary hover:text-text-primary`;

  return (
    <NotificationContext.Provider
      value={{ notify, confirm: confirmAsync, confirmChoice }}
    >
      {children}

      {/* Toast & popup dikirim lewat portal ke <body> — menutupi SELURUH viewport
          (termasuk navbar/sidebar), tidak terjebak stacking context halaman */}
      {typeof document !== "undefined" &&
        createPortal(
          <>
            {toast && (
              <div
                onClick={() => setToast(null)}
                className={`fixed top-4 right-4 z-[10000] flex w-[calc(100vw-2rem)] max-w-[380px] flex-col gap-2 break-words cursor-pointer rounded-md border px-[18px] py-3 text-[13.5px] font-bold shadow-lg animate-[rpToastIn_0.3s_ease-out_both] ${toastVariants[toast.type] || toastVariants.success}`}
              >
                {toast.message}
              </div>
            )}
            {confirmData && (
              <div
                onClick={confirmData.onNo}
                className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border bg-white p-6 text-text-primary shadow-xl animate-[rpModalPop_0.25s_cubic-bezier(0.22,1,0.36,1)_both]"
                >
                  <div
                    className="mb-2 flex items-center justify-center"
                    style={{ fontSize: 32 }}
                  >
                    {confirmData.choices ? (
                      <Image
                        src="/icons/caution.png"
                        width={32}
                        height={32}
                        alt="Peringatan"
                      />
                    ) : (
                      "🤔"
                    )}
                  </div>
                  <p className="mb-0 text-center text-[15px] font-bold">
                    {confirmData.message}
                  </p>
                  <div className="flex flex-wrap justify-center gap-3 pt-4">
                    {confirmData.choices ? (
                      <>
                        {confirmData.choices.map((c, i) => (
                          <button
                            key={i}
                            onClick={() => confirmData.onChoice(c.value)}
                            className={
                              c.bg ? `${buttonBase} ${c.bg}` : buttonPrimary
                            }
                          >
                            {c.label}
                          </button>
                        ))}
                        <button
                          onClick={confirmData.onNo}
                          className={buttonGhost}
                        >
                          Batal
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={confirmData.onNo}
                          className={buttonGhost}
                        >
                          Batal
                        </button>
                        <button
                          onClick={confirmData.onYes}
                          className={buttonPrimary}
                        >
                          Ya
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body,
        )}
    </NotificationContext.Provider>
  );
}
