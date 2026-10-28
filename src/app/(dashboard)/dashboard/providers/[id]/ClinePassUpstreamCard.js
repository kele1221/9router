"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Card, Button, Badge } from "@/shared/components";

/**
 * Per-model upstream channels for ClinePass.
 *
 * The pin itself lives in the registry (`upstreamPin` on the model), so this
 * card only shows it and lists the channels the gateway discloses. A locked
 * model is one the gateway can only serve from the pinned channel: the probe is
 * rejected and names that channel, so the list is its proof.
 */
export default function ClinePassUpstreamCard({ providerId, models }) {
  const pinnedModels = models.filter((m) => m.upstreamPin?.upstreams?.length);
  const [results, setResults] = useState({});
  const [probing, setProbing] = useState("");

  const probe = async (modelId) => {
    setProbing(modelId);
    try {
      const res = await fetch(
        `/api/providers/${providerId}/upstreams?model=${encodeURIComponent(modelId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      setResults((prev) => ({ ...prev, [modelId]: data }));
    } catch (error) {
      setResults((prev) => ({ ...prev, [modelId]: { reachable: false, upstreams: [], error: error.message } }));
    } finally {
      setProbing("");
    }
  };

  if (pinnedModels.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Upstream Channels</h2>
          <p className="text-xs text-text-muted">
            Pinned models only use the channel below. Check asks the gateway to name the channels it allows, without running the model.
          </p>
        </div>
      </div>
      <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {pinnedModels.map((model) => {
          const pinned = model.upstreamPin.upstreams.join(", ");
          const result = results[model.id];
          return (
            <div key={model.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-sm text-text-main">{model.id}</span>
                <span className="text-xs text-text-muted">
                  Pinned: <span className="font-medium text-text-main">{pinned}</span>
                  {" · "}
                  {model.upstreamPin.mode === "strict" ? "strict" : "preferred"}
                </span>
                {result && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {result.upstreams?.length > 0 ? (
                      result.upstreams.map((name) => (
                        <Badge key={name} size="sm" variant={name.toLowerCase() === pinned.toLowerCase() ? "success" : "default"}>
                          {name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        {result.reachable ? "No channels listed" : `Unverified${result.error ? `: ${result.error}` : ""}`}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon="travel_explore"
                loading={probing === model.id}
                onClick={() => probe(model.id)}
              >
                Check
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

ClinePassUpstreamCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  models: PropTypes.array.isRequired,
};
