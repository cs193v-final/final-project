import { MODES, type GameMode } from "./modes";
import { ButtonLink, SectionHeading } from "./ui/controls";

/**
 * The home screen's list of ways to play (#50). Available modes link to their
 * page. Modes that aren't built yet are listed but clearly marked "Coming
 * soon" in text, and aren't links, so keyboard users never tab onto a dead end.
 */
export function ModePicker({ modes = MODES }: { modes?: readonly GameMode[] }) {
  return (
    <section aria-labelledby="choose-mode" className="w-full max-w-2xl">
      <SectionHeading id="choose-mode">Choose a mode</SectionHeading>
      <ul className="grid gap-3 sm:grid-cols-3">
        {modes.map((mode) => (
          <li
            key={mode.id}
            className={
              mode.status === "available"
                ? "flex flex-col gap-2 rounded-xl border border-zinc-300 bg-white p-4 text-left dark:border-zinc-700 dark:bg-zinc-900"
                : "flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-left dark:border-zinc-700"
            }
          >
            <h3 className="text-lg font-semibold">{mode.title}</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{mode.description}</p>
            {mode.status === "available" ? (
              <ButtonLink href={mode.href} className="mt-auto self-start">
                {mode.cta}
              </ButtonLink>
            ) : (
              <p className="mt-auto self-start rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                Coming soon
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
