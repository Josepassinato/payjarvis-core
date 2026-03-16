"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const audiences = [
  { value: "all", label: "All Users" },
  { value: "telegram", label: "Telegram Only" },
  { value: "whatsapp", label: "WhatsApp Only" },
  { value: "premium", label: "Premium Users" },
  { value: "active", label: "Active (30d)" },
  { value: "inactive", label: "Inactive" },
];

export default function NewBroadcastPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [audience, setAudience] = useState("all");
  const [sendNow, setSendNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");
  const [recipientCount, setRecipientCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    api(`/admin/broadcasts/preview?audience=${audience}`).then((d) =>
      setRecipientCount(d.recipientCount || 0)
    );
  }, [audience]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const broadcast = await api("/admin/broadcasts", {
        method: "POST",
        body: JSON.stringify({ title, message, imageUrl: imageUrl || undefined, audience }),
      });

      if (sendNow) {
        await api(`/admin/broadcasts/${broadcast.broadcast.id}/send`, { method: "POST" });
      } else if (scheduledAt) {
        await api(`/admin/broadcasts/${broadcast.broadcast.id}/schedule`, {
          method: "POST",
          body: JSON.stringify({ scheduledAt }),
        });
      }

      router.push("/broadcast");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <button onClick={() => router.back()} className="text-sm text-[#64748B] hover:text-[#0F172A]">
        &larr; Back to Broadcasts
      </button>

      <h1 className="text-2xl font-bold">New Broadcast</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Title (internal)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4A9EFF]"
            placeholder="e.g. Welcome Week 1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Image URL (optional)</label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4A9EFF]"
            placeholder="https://..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4A9EFF] resize-none"
            placeholder="Your broadcast message..."
          />
        </div>

        {/* Preview */}
        {message && (
          <div className="bg-[#F8FAFC] rounded-xl p-4 border border-[#E2E8F0]">
            <p className="text-xs text-[#64748B] mb-2">Preview</p>
            <div className="bg-white rounded-lg p-3 shadow-sm text-sm whitespace-pre-wrap">{message}</div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Audience</label>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm"
          >
            {audiences.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <p className="text-sm text-[#4A9EFF] mt-2 font-medium">
            This message will reach {recipientCount} users
          </p>
        </div>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={sendNow} onChange={() => setSendNow(true)} />
            Send Now
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={!sendNow} onChange={() => setSendNow(false)} />
            Schedule
          </label>
        </div>

        {!sendNow && (
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm"
          />
        )}

        <button
          onClick={() => setShowConfirm(true)}
          disabled={!title || !message}
          className="w-full py-3 bg-[#4A9EFF] text-white rounded-lg font-medium disabled:opacity-50"
        >
          {sendNow ? `Send to ${recipientCount} users` : "Schedule Broadcast"}
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-bold mb-2">Confirm Broadcast</h2>
            <p className="text-sm text-[#64748B] mb-4">
              {sendNow
                ? `Send "${title}" to ${recipientCount} users now?`
                : `Schedule "${title}" for ${scheduledAt}?`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 border border-[#E2E8F0] rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-2 bg-[#4A9EFF] text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {loading ? "Sending..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
