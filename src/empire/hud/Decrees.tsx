import { Bell, CaretRight } from "@phosphor-icons/react";
import { type Campaign, type Kingdom, buildingFor, postureStyle } from "../realm";

export function Decrees({
  campaigns,
  kingdoms,
  selectedId,
  onPick,
  onNext,
}: {
  campaigns: Campaign[];
  kingdoms: Kingdom[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <aside className="ae-decrees" aria-label="Awaiting your decree">
      <header>
        <Bell weight="fill" />
        <span>Awaiting your decree</span>
        <b>{campaigns.length}</b>
      </header>
      <ol>
        {campaigns.map((c) => {
          const kingdom = kingdoms.find((k) => k.id === c.kingdomId);
          const style = postureStyle[c.posture];
          return (
            <li key={c.id}>
              <button
                type="button"
                className={selectedId === c.id ? "is-selected" : ""}
                onClick={() => onPick(c.id)}
              >
                <span className="ae-decree-glyph" style={{ color: style.color, borderColor: style.color }}>
                  {style.glyph}
                </span>
                <span className="ae-decree-text">
                  <strong>
                    <i style={{ background: kingdom?.banner }} /> {c.id} · {buildingFor(c.stage).name}
                  </strong>
                  <span>{c.attentionLabel}</span>
                </span>
                <CaretRight />
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="ae-idle-button"
        onClick={onNext}
        title="Next decree (.) · previous (,)"
      >
        Next decree <kbd>.</kbd>
      </button>
    </aside>
  );
}
