import {
  PetCompanion,
  type PetState,
} from "@/modules/pi-agent/PetCompanion";
import { setPetId } from "@/modules/settings/store";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import "./pet.css";

function PetOverlay() {
  const [state, setState] = useState<PetState>("idle");

  useEffect(() => {
    let active = true;
    const unlisten = listen<PetState>("agni:pet-state", (event) => {
      if (active) setState(event.payload);
    });
    return () => {
      active = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const hide = () => {
    void setPetId(null);
    void invoke("pet_overlay_hide");
  };

  return (
    <div
      aria-label="Agni pet. Drag to move. Right-click to hide."
      className="flex h-full w-full items-center justify-center"
      onContextMenu={(event) => {
        event.preventDefault();
        hide();
      }}
      onPointerDown={() => {
        void getCurrentWindow().startDragging();
      }}
      role="img"
      title="Drag to move. Right-click to hide."
    >
      <PetCompanion scale={0.5} state={state} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("pet-root") as HTMLElement).render(
  <PetOverlay />,
);

setTimeout(() => {
  void getCurrentWindow().show();
}, 0);
