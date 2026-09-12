import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setPetId } from "@/modules/settings/store";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "../components/SectionHeader";

type Pet = {
  id: string;
  displayName: string;
  description: string;
};

type CatalogPet = { slug: string; name: string; previewUrl: string };

const CATALOG: CatalogPet[] = [
  ["kyokit-cj3", "KyoKit", "0b770823-0e8d-4d84-8077-f24bb1994a2e"], ["codex-ninja-szig83", "Codex Ninja", "7ec9be98-9d18-4ab0-882b-17a7220b8bcd"],
  ["mousey-stephenjwhite", "Mousey", "501a9a27-95c4-4aae-bc11-605f993aada8"], ["monkey-d-luffy-1122", "Monkey D Luffy", "c307bcd7-a65d-437b-a678-7888f5df3ed7"],
  ["vanlife-esme-iloapps", "vanlife_esme", "e457b56a-49e2-4bd6-b24b-7d5dcb8fcfc1"], ["lando-iloapps", "Lando", "1400456b-f2ee-498a-9468-da5db3c572ca"],
  ["hopper-bretgreenstein", "Hopper", "44532b75-63cb-47f5-af7d-f93439976b05"], ["plat-critters-quest", "Plat", "0df23c59-6528-4117-9c83-922ad619d66e"],
  ["algofox-dude", "Algofox", "3f2054e4-9bfd-46a9-8c26-c0a5d7af0989"], ["kyokit-reeucq", "KyoKit", "d0261638-31f9-4c79-8d12-12cc13d6b17c"],
  ["gulte-mama-nazmussayad", "Gulte Mama", "2d16d010-d49a-4514-9a59-d2f24b77306b"], ["gopal-nazmussayad", "Gopal", "7dc65aca-3a52-425b-9554-6ae41f163275"],
  ["alien-x-pet-nazmussayad", "Alien X Pet", "90902cde-dd82-4691-a9aa-11b924cd4433"], ["thrungle-timtim", "Thrungle", "39b030a4-787f-4942-9ee3-2688468e8910"],
  ["monkey-d-luffy-timtim", "Monkey D Luffy", "b73b975f-414d-4d62-a5cc-745aa8b40fbc"], ["bipy-douglas-strey", "Bipy", "2e37d3b0-50a6-4d4d-ad23-07be685084a5"],
  ["bro-bro", "Bro", "7ec89c2d-3c21-4677-9291-55631e14b695"], ["firefang-timtim", "Firefang", "88582da2-75eb-4f09-8204-a74793e249d0"],
  ["sukuna-girgis", "Sukuna", "9970a888-c26a-475d-8dd8-d2bd59152319"], ["doodle-bob-girgis", "Doodle Bob", "81784df8-1539-4f4b-9fc4-1a6be717040b"],
  ["boostr-yanvi", "Boostr", "678291a1-140f-4dfc-9671-f532fa06a806"], ["gob-weswinder", "Gob", "5d830382-91b8-4aba-a5cb-9091ff4ccb46"],
  ["biscuit-wes", "Biscuit", "12ca480c-8cae-4831-8c6f-b08adffaf27c"], ["bytecap-wes", "Bytecap", "0fce42e1-ed27-4eb5-ae75-bcd0eba72919"],
  ["voltling-wes", "Voltling", "5b8ed4c5-14cb-44f8-8d14-1b90b240922c"], ["pebbit-wes", "Pebbit", "98c89e43-bec3-444d-8860-e87b0ebe4d69"],
  ["quillbit-wes", "Quillbit", "95184d24-36ae-4011-abc2-b1025dc14c08"], ["glitchlet-wes", "Glitchlet", "10482885-5246-4fcb-80f6-c2f6393225f8"],
  ["tack-wes", "Tack", "6a83cc4f-0bc0-4fd4-aade-92c5c86454d1"], ["mochip-wes", "Mochip", "3ca86986-ecfa-4146-93c3-f9f41e77d074"],
  ["snips-wes", "Snips", "07ebd708-2171-42df-b8bd-5b7d7e8dd7bc"], ["kernel-wes", "Kernel", "1f3ec16e-7c6a-4538-b50c-0b7f3e9357f8"],
].map(([slug, name, assetId]) => ({
  slug,
  name,
  previewUrl: `https://precious-ptarmigan-848.convex.cloud/api/storage/${assetId}`,
}));

function PetPreview({ pet }: { pet: CatalogPet }) {
  return (
    <div className="relative size-13 shrink-0 overflow-hidden rounded-md border border-border/60 bg-foreground/[0.03] [image-rendering:pixelated]">
      <img
        alt={`${pet.name} preview`}
        className="absolute top-0 left-0 max-w-none"
        height={468}
        loading="lazy"
        src={pet.previewUrl}
        width={384}
      />
    </div>
  );
}

export function PetsSection() {
  const petId = usePreferencesStore((s) => s.petId);
  const [installed, setInstalled] = useState<Pet[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInstalled(await invoke<Pet[]>("pets_list"));
    } catch (error) {
      toast.error("Could not load Agni pets", { description: String(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? CATALOG.filter((pet) => pet.name.toLowerCase().includes(term)) : CATALOG;
  }, [query]);

  const selectPet = async (id: string) => {
    await setPetId(id);
    await invoke("pet_overlay_show");
  };

  const hidePet = async () => {
    await setPetId(null);
    await invoke("pet_overlay_hide");
  };

  const install = async (slug: string) => {
    setBusy(slug);
    try {
      const pet = await invoke<Pet>("pets_install_catalog", { slug });
      await refresh();
      await selectPet(pet.id);
      toast.success(`${pet.displayName} is now your desktop companion`);
    } catch (error) {
      toast.error("Pet install failed", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const importPet = async () => {
    setBusy("import");
    try {
      const pet = await invoke<Pet | null>("pets_import");
      if (!pet) return;
      await refresh();
      await selectPet(pet.id);
      toast.success(`${pet.displayName} is now your desktop companion`);
    } catch (error) {
      toast.error("Pet import failed", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (pet: Pet) => {
    setBusy(pet.id);
    try {
      if (petId === pet.id) await hidePet();
      await invoke("pets_remove", { id: pet.id });
      await refresh();
    } catch (error) {
      toast.error("Could not remove pet", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Pets" description="Pick one companion for the Pi panel. Agni downloads only pets you install." />

      <section className="rounded-xl border border-border/60 bg-card/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12.5px] font-medium">Your companions</p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">Stored in Agni's app data, separate from Codex.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void importPet()} disabled={busy !== null}>Import ZIP</Button>
            <Button size="sm" variant="ghost" onClick={() => void hidePet()} disabled={!petId}>Hide pet</Button>
          </div>
        </div>
        {installed.length === 0 ? (
          <p className="mt-4 text-[11px] text-muted-foreground">No pet installed yet.</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {installed.map((pet) => (
              <div key={pet.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5", petId === pet.id ? "border-primary/50 bg-primary/5" : "border-border/60")}>
                <button type="button" onClick={() => void selectPet(pet.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[12px] font-medium">{pet.displayName}</p>
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{pet.description || "Custom Agni pet"}</p>
                </button>
                <Button size="sm" variant="ghost" onClick={() => void remove(pet)} disabled={busy !== null}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12.5px] font-medium">Pet Store</p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">Browse community packs from Coding Pets. Nothing is downloaded until you install one.</p>
          </div>
          <button type="button" onClick={() => void openUrl("https://codingpets.com/")} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Open gallery</button>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pets" className="mb-3 h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] outline-none focus:border-foreground/40" />
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((pet) => (
            <div key={pet.slug} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <PetPreview pet={pet} />
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium">{pet.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">Coding Pets community pack</p>
                </div>
              </div>
              <Button size="sm" onClick={() => void install(pet.slug)} disabled={busy !== null}>{busy === pet.slug ? "Installing" : "Install"}</Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
