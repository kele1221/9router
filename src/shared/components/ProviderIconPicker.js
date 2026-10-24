"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { resolveNodeIconSrc } from "@/shared/utils/providerIcon";
import { PRESET_PROVIDER_ICONS } from "@/shared/constants/providerIconPresets";
import { cn } from "@/shared/utils/cn";

// Client-side: shrink any picked image to a 96x96 PNG data URL so the stored
// payload stays small. Square-contain (letterbox) to preserve aspect ratio.
const MAX_PREVIEW_SIZE = 96;
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB pre-resize guard

function fileToResizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file"));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error("Image is too large (max 4MB)"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const size = MAX_PREVIEW_SIZE;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const COLOR_SWATCHES = [
  { value: null, label: "Auto", className: "bg-gradient-to-br from-emerald-400 via-violet-400 to-amber-400" },
  { value: "#10A37F", label: "OpenAI" },
  { value: "#D97757", label: "Anthropic" },
  { value: "#4D6BFE", label: "DeepSeek" },
  { value: "#A855F7", label: "Purple" },
  { value: "#6366F1", label: "Indigo" },
  { value: "#0EA5E9", label: "Sky" },
  { value: "#EF4444", label: "Red" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#14B8A6", label: "Teal" },
  { value: "#EC4899", label: "Pink" },
  { value: "#64748B", label: "Slate" },
];

/**
 * Picker for a custom provider node's icon.
 *
 * value: { icon, iconColor, textIcon }
 *   - icon: preset id ("openai") | data: URL (uploaded) | null
 *   - iconColor: hex string | null
 *   - textIcon: 1-4 char fallback badge | null
 * onChange(next): receives the full next state object.
 */
export default function ProviderIconPicker({
  value,
  onChange,
  defaultColor = "#10A37F",
  defaultTextIcon = "OC",
  name = "",
  label = "Icon",
}) {
  const icon = value?.icon ?? null;
  const iconColor = value?.iconColor ?? null;
  const textIcon = value?.textIcon ?? null;
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const derivedBadge = useMemo(() => {
    if (textIcon) return textIcon;
    const base = (name || "").trim();
    if (base) return base.slice(0, 2).toUpperCase();
    return defaultTextIcon;
  }, [textIcon, name, defaultTextIcon]);

  const previewSrc = resolveNodeIconSrc(icon);
  const chipColor = iconColor || defaultColor;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PRESET_PROVIDER_ICONS;
    return PRESET_PROVIDER_ICONS.filter(
      (p) => p.id.includes(q) || p.label.toLowerCase().includes(q),
    );
  }, [query]);

  const isPreset = typeof icon === "string" && !icon.startsWith("data:");
  const isUploaded = typeof icon === "string" && icon.startsWith("data:");

  const handleUpload = useCallback(
    async (file) => {
      setError("");
      setUploading(true);
      try {
        const dataUrl = await fileToResizedDataUrl(file);
        onChange({ icon: dataUrl, iconColor, textIcon });
      } catch (e) {
        setError(e.message || "Failed to load image");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onChange, iconColor, textIcon],
  );

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <label className="text-sm font-medium text-text-main">{label}</label>
      )}

      {/* Preview + actions */}
      <div className="flex items-center gap-4">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-lg overflow-hidden"
          style={{
            backgroundColor:
              chipColor.length > 7 ? chipColor : `${chipColor}15`,
          }}
        >
          <ProviderIcon
            src={previewSrc || undefined}
            alt={name || "provider icon"}
            size={36}
            className="object-contain rounded-lg max-w-[36px] max-h-[36px]"
            fallbackText={derivedBadge}
            fallbackColor={chipColor}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-main hover:bg-surface-3 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">upload</span>
            {isUploaded ? "Replace upload" : "Upload icon"}
          </button>
          <button
            type="button"
            onClick={() => onChange({ icon: null, iconColor, textIcon })}
            disabled={!icon}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            Use default
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
        />
      </div>

      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}

      {/* Preset grid */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <span className="material-symbols-outlined text-[18px] absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search preset icons…"
            className="w-full py-1.5 pl-8 pr-3 text-sm text-text-main bg-surface-2 rounded-[8px] border border-transparent placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
          />
        </div>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 max-h-44 overflow-y-auto rounded-[10px] border border-border p-2 bg-surface-1">
          {filtered.map((p) => {
            const selected = isPreset && icon === p.id;
            return (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => onChange({ icon: p.id, iconColor, textIcon })}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-[8px] border transition-all",
                  selected
                    ? "border-brand-500 ring-2 ring-brand-500/30 bg-brand-500/10"
                    : "border-transparent hover:bg-surface-2 hover:border-border",
                )}
              >
                <ProviderIcon
                  src={`/providers/${p.id}.png`}
                  alt={p.label}
                  size={24}
                  className="object-contain max-w-[24px] max-h-[24px]"
                  fallbackText={p.label.slice(0, 2).toUpperCase()}
                />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-xs text-text-muted py-4">
              No preset icons match “{query}”.
            </div>
          )}
        </div>
      </div>

      {/* Accent color */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-text-muted">Accent color</span>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_SWATCHES.map((c) => {
            const active = (iconColor ?? null) === c.value;
            return (
              <button
                key={c.label}
                type="button"
                title={c.label}
                onClick={() => onChange({ icon, iconColor: c.value, textIcon })}
                className={cn(
                  "size-6 rounded-full border transition-all",
                  active
                    ? "border-brand-500 ring-2 ring-brand-500/30 scale-110"
                    : "border-border hover:scale-105",
                  !c.value && c.className,
                )}
                style={c.value ? { backgroundColor: c.value } : undefined}
              >
                {!c.value && (
                  <span className="text-[9px] font-bold text-white mix-blend-difference">
                    A
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Badge text */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-muted">
          Fallback badge text
        </span>
        <input
          type="text"
          value={textIcon || ""}
          maxLength={4}
          onChange={(e) =>
            onChange({
              icon,
              iconColor,
              textIcon: e.target.value || null,
            })
          }
          placeholder={derivedBadge}
          className="w-24 py-1.5 px-3 text-sm text-text-main bg-surface-2 rounded-[8px] border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40"
        />
      </div>
    </div>
  );
}

ProviderIconPicker.propTypes = {
  value: PropTypes.shape({
    icon: PropTypes.string,
    iconColor: PropTypes.string,
    textIcon: PropTypes.string,
  }),
  onChange: PropTypes.func.isRequired,
  defaultColor: PropTypes.string,
  defaultTextIcon: PropTypes.string,
  name: PropTypes.string,
  label: PropTypes.string,
};
