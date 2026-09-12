import { usePreferencesStore } from "@/modules/settings/preferences";
import type { PetState } from "@/modules/pi-agent/PetCompanion";
import { usePiStore } from "@/modules/pi-agent/store";
import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

export function PetOverlayBridge() {
  const init = usePreferencesStore((state) => state.init);
  const hydrated = usePreferencesStore((state) => state.hydrated);
  const petId = usePreferencesStore((state) => state.petId);
  const notificationsEnabled = usePreferencesStore(
    (state) => state.agentNotifications,
  );
  const pi = usePiStore();
  const focused = useWindowFocus();
  const [completedUntil, setCompletedUntil] = useState(0);
  const wasWorking = useRef(false);
  const wasAwaitingInput = useRef(false);
  const announcedCompletion = useRef(0);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!hydrated) return;
    void invoke(petId ? "pet_overlay_show" : "pet_overlay_hide").catch(
      () => undefined,
    );
  }, [hydrated, petId]);

  const unavailable =
    pi.connection === "error" ||
    pi.connection === "exited" ||
    pi.connection === "stopped";
  const working = pi.session.isStreaming || pi.session.isCompacting;

  useEffect(() => {
    const finished =
      wasWorking.current &&
      !working &&
      !pi.extensionRequest &&
      !pi.rpcError &&
      !unavailable;
    wasWorking.current = working;
    if (working) {
      setCompletedUntil(0);
    } else if (finished) {
      setCompletedUntil(Date.now() + 10_000);
    }
  }, [working, pi.extensionRequest, pi.rpcError, unavailable]);

  useEffect(() => {
    if (!completedUntil) return;
    const delay = Math.max(0, completedUntil - Date.now());
    const timeout = window.setTimeout(() => setCompletedUntil(0), delay);
    return () => window.clearTimeout(timeout);
  }, [completedUntil]);

  useEffect(() => {
    const awaitingInput = Boolean(pi.extensionRequest);
    if (
      petId &&
      awaitingInput &&
      !wasAwaitingInput.current &&
      notificationsEnabled &&
      !focused
    ) {
      void osNotify("Pi needs your input", "Your Agni pet is waiting.");
    }
    wasAwaitingInput.current = awaitingInput;
  }, [petId, pi.extensionRequest, notificationsEnabled, focused]);

  useEffect(() => {
    if (
      petId &&
      completedUntil &&
      announcedCompletion.current !== completedUntil &&
      notificationsEnabled &&
      !focused
    ) {
      announcedCompletion.current = completedUntil;
      void osNotify("Pi finished", "Your Agni pet has an update.");
    }
  }, [petId, completedUntil, notificationsEnabled, focused]);

  const petState: PetState =
    pi.rpcError || unavailable
      ? "failed"
      : pi.extensionRequest
        ? "review"
        : working
          ? "running"
          : pi.connection === "starting"
            ? "waiting"
            : completedUntil
              ? "done"
              : "idle";

  useEffect(() => {
    if (!petId) return;
    void emitTo("pet", "agni:pet-state", petState).catch(() => undefined);
  }, [petId, petState]);

  return null;
}
import { osNotify } from "@/modules/agents/lib/notify";
import { useWindowFocus } from "@/modules/agents/lib/useWindowFocus";
