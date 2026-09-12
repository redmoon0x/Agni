import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type PetSprite = {
  dataUrl: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
};

export type PetState =
  | "idle"
  | "running"
  | "waiting"
  | "review"
  | "done"
  | "failed";

const ROW: Record<PetState, number> = {
  idle: 0,
  done: 3,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
};

const FRAMES: Record<PetState, number> = {
  idle: 6,
  done: 4,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6,
};

export function PetCompanion({
  state,
  scale = 0.22,
}: {
  state: PetState;
  scale?: number;
}) {
  const init = usePreferencesStore((preferences) => preferences.init);
  const petId = usePreferencesStore((preferences) => preferences.petId);
  const [sprite, setSprite] = useState<PetSprite | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    setSprite(null);
    setFrame(0);
    if (!petId) return;
    let active = true;
    void invoke<PetSprite>("pets_sprite", { id: petId })
      .then((next) => {
        if (active) setSprite(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [petId]);

  useEffect(() => {
    setFrame(0);
    const interval = window.setInterval(() => {
      setFrame((current) => (current + 1) % FRAMES[state]);
    }, state === "running" ? 120 : 170);
    return () => window.clearInterval(interval);
  }, [state]);

  if (!sprite) return null;
  const width = Math.round(sprite.frameWidth * scale);
  const height = Math.round(sprite.frameHeight * scale);

  return (
    <div
      aria-label={`Pi companion is ${state}`}
      role="img"
      className="shrink-0 [image-rendering:pixelated]"
      style={{
        width,
        height,
        backgroundImage: `url(${sprite.dataUrl})`,
        backgroundPosition: `-${frame * width}px -${ROW[state] * height}px`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${sprite.columns * width}px auto`,
      }}
    />
  );
}
