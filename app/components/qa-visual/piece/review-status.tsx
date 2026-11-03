import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDashed,
  Eye,
  LoaderCircle,
  UserRound,
} from "lucide-react";
import type {
  AiReviewState,
  HumanReviewState,
  ReviewTone,
} from "@/app/lib/qa-visual/review-state";
import { Avatar } from "@/app/components/qa-visual/shared/visuals";

function StateIcon({
  tone,
  animate = false,
}: {
  tone: ReviewTone;
  animate?: boolean;
}) {
  if (tone === "success") return <Check size={11} />;
  if (tone === "warning" || tone === "danger") return <Eye size={11} />;
  if (tone === "progress")
    return animate ? (
      <LoaderCircle size={11} className="state-progress-icon" />
    ) : (
      <Eye size={11} />
    );
  return <CircleDashed size={11} />;
}

function ReviewerAvatar({
  author,
  small = false,
}: {
  author: string;
  small?: boolean;
}) {
  return <Avatar type="you" name={author} small={small} />;
}

export function CompactReviewStatus({
  ai,
  human,
}: {
  ai: AiReviewState;
  human: HumanReviewState;
}) {
  return (
    <div className="piece-dual-status">
      <div
        className={`mini-review-state state-${ai.tone}`}
        title={`Revisión IA: ${ai.title}. ${ai.detail}`}
      >
        <Avatar type="robot" small />
        <div>
          <span>REVISIÓN IA</span>
          <strong>
            <StateIcon tone={ai.tone} animate />
            <span className="mini-state-label">{ai.shortLabel}</span>
          </strong>
        </div>
      </div>
      <div
        className={`mini-review-state state-${human.tone}`}
        title={`Revisión humana: ${human.title}. ${human.detail}`}
      >
        {human.author ? (
          <ReviewerAvatar author={human.author} small />
        ) : (
          <span className="human-placeholder">
            <UserRound size={14} />
          </span>
        )}
        <div>
          <span>HUMANA</span>
          <strong>
            <StateIcon tone={human.tone} />
            <span className="mini-state-label">{human.shortLabel}</span>
            {human.hasException && (
              <span className="exception-dot" title="Aprobada con excepción" />
            )}
          </strong>
        </div>
      </div>
    </div>
  );
}

export function ReviewStatusBar({
  ai,
  human,
  pieceName,
  version,
  onOpenAi,
  onOpenHuman,
}: {
  ai: AiReviewState;
  human: HumanReviewState;
  pieceName: string;
  version: number;
  onOpenAi: () => void;
  onOpenHuman: () => void;
}) {
  return (
    <section
      className="review-status-strip"
      aria-label="Estado de revisión IA y aprobación humana"
    >
      <button
        className={`review-state-card ai-state-card state-${ai.tone}`}
        onClick={onOpenAi}
        aria-label={`Revisión IA: ${ai.title}. Ver resultado`}
      >
        <span className="review-identity robot-identity">
          <Avatar type="robot" />
          <span className={`identity-indicator state-${ai.tone}`}>
            <StateIcon tone={ai.tone} animate />
          </span>
        </span>
        <span className="review-state-copy">
          <span className="review-state-eyebrow">REVISIÓN IA</span>
          <strong className="review-state-title">{ai.title}</strong>
          <span className="review-state-detail">{ai.detail}</span>
        </span>
        <span className="review-state-action">
          <span>
            {ai.status === "findings" ? "Ver hallazgos" : "Ver revisión"}
          </span>
          <ArrowUpRight size={14} />
        </span>
      </button>
      <div
        className={`review-state-card human-state-card state-${human.tone}`}
        role="group"
        aria-label={`Aprobación humana de ${pieceName}, versión ${version}: ${human.title}`}
      >
        <span className="review-identity human-identity">
          {human.author ? (
            <ReviewerAvatar author={human.author} />
          ) : (
            <UserRound size={21} />
          )}
          <span className={`identity-indicator state-${human.tone}`}>
            <StateIcon tone={human.tone} />
          </span>
        </span>
        <span className="review-state-copy">
          <span className="review-state-eyebrow">APROBACIÓN HUMANA</span>
          <strong className="review-state-title">{human.title}</strong>
          <span className="review-state-detail">{human.detail}</span>
        </span>
        <button
          className={`button ${human.tone === "success" ? "secondary" : "primary"} piece-approval-action`}
          onClick={onOpenHuman}
          aria-label={`${human.tone === "success" ? "Ver decisión" : "Aprobar esta versión"}: ${pieceName}, versión ${version}`}
        >
          {human.tone === "success" ? (
            <>
              <span>Ver decisión</span>
              <ChevronRight size={14} />
            </>
          ) : (
            <>
              <CheckCheck size={14} />
              <span>Aprobar esta versión</span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}
