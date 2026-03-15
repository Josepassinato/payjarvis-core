"use client";

import { useState } from "react";

interface NfcShareProps {
  url: string;
  qrCodeBase64: string;
  onClose?: () => void;
}

type NfcStatus = "idle" | "writing" | "success" | "error" | "unsupported";

export function NfcShare({ url, qrCodeBase64, onClose }: NfcShareProps) {
  const [status, setStatus] = useState<NfcStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supportsNfc = typeof window !== "undefined" && "NDEFReader" in window;

  const handleNfcWrite = async () => {
    if (!supportsNfc) {
      setStatus("unsupported");
      return;
    }

    setStatus("writing");
    try {
      const ndef = new (window as any).NDEFReader();
      await ndef.write({
        records: [{ recordType: "url", data: url }],
      });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Erro ao escrever NFC");
    }
  };

  return (
    <div className="space-y-4">
      {/* NFC Button (Android) */}
      {supportsNfc && status !== "unsupported" && (
        <div className="space-y-3">
          <button
            onClick={handleNfcWrite}
            disabled={status === "writing"}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 rounded-xl hover:bg-indigo-600/30 transition-colors disabled:opacity-50"
          >
            {status === "writing" ? (
              <>
                <div className="relative flex items-center justify-center w-6 h-6">
                  <div className="absolute w-6 h-6 rounded-full border-2 border-indigo-400/30 animate-ping" />
                  <div className="absolute w-4 h-4 rounded-full border-2 border-indigo-400/50 animate-ping animation-delay-200" />
                  <div className="w-2 h-2 rounded-full bg-indigo-400" />
                </div>
                <span className="text-sm font-medium">Aproxime os celulares...</span>
              </>
            ) : status === "success" ? (
              <>
                <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                <span className="text-sm font-medium text-green-300">Link enviado por NFC!</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 8.32a7.43 7.43 0 010 7.36" />
                  <path d="M9.46 6.21a11.76 11.76 0 010 11.58" />
                  <path d="M12.91 4.1a16.07 16.07 0 010 15.8" />
                  <path d="M16.37 2a20.4 20.4 0 010 20" />
                </svg>
                <span className="text-sm font-medium">Aproximar do outro celular (NFC)</span>
              </>
            )}
          </button>

          {status === "error" && (
            <p className="text-center text-xs text-red-400">{errorMsg}</p>
          )}
        </div>
      )}

      {/* QR Code fallback */}
      <div className="space-y-2">
        {(status === "unsupported" || !supportsNfc) && (
          <p className="text-center text-xs text-white/50">
            Peça ao amigo escanear o QR Code
          </p>
        )}
        {supportsNfc && status === "idle" && (
          <p className="text-center text-xs text-white/40">ou use o QR Code abaixo</p>
        )}
        <div className="flex justify-center">
          <div className="bg-white p-3 rounded-xl">
            <img
              src={qrCodeBase64}
              alt="QR Code para compartilhar"
              className="w-48 h-48"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
