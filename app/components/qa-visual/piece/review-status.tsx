import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDashed,
  Eye,
  LoaderCircle,
  UserRound,
  RotateCcw,
  Building2,
  BadgeCheck,
} from "lucide-react";
import type {
  AiReviewState,
  HumanReviewState,
  ReviewTone,
} from "@/app/lib/qa-visual/review-state";
import { Avatar } from "@/app/components/qa-visual/shared/visuals";
import { finalApprovalState, internalClientState } from "@/app/lib/qa-visual/client-state";
import type { PieceClientStatus } from "@/convex/qaVisual/clientReview";

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
  onReanalyze,
  reanalyzing = false,
  client,
}: {
  ai: AiReviewState;
  human: HumanReviewState;
  pieceName: string;
  version: number;
  onOpenAi: () => void;
  onOpenHuman: () => void;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
  client?: PieceClientStatus | null;
}) {
  // The client card is always visible: internal approval alone does not finish a piece.
  const clientState = internalClientState(client);
  const final = finalApprovalState(client, human.tone === "success");
  return (
    <section
      className="review-status-strip with-client"
      aria-label="Estado de revisión IA y aprobación humana"
    >
      <div className="ai-state-wrap">
      {onReanalyze && (
        <button
          type="button"
          className="qa-reanalyze"
          disabled={reanalyzing}
          onClick={onReanalyze}
          title={reanalyzing ? "Esta pieza ya se está analizando" : "Volver a analizar esta versión"}
          aria-label={`Volver a analizar ${pieceName}, versión ${version}`}
        >
          <RotateCcw size={13} />
        </button>
      )}
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
      </div>
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
      <div
        className={`review-state-card client-state-card tone-${final?.final ? "success" : clientState.tone} ${final?.final ? "final" : ""}`}
        role="group"
        aria-label={`Aprobación final del cliente: ${final?.title ?? clientState.label}`}
      >
        <span className="review-identity">
          {final?.final ? <BadgeCheck size={22} /> : <Building2 size={20} />}
        </span>
        <span className="review-state-copy">
          <span className="review-state-eyebrow">CLIENTE · APROBACIÓN FINAL</span>
          <strong className="review-state-title">{final?.final ? "Aprobación final" : clientState.label}</strong>
          <span className="review-state-detail">
            {final && !final.final ? final.detail : clientState.detail}
          </span>
        </span>
      </div>
    </section>
  );
}

/** Highlights whether the piece is finished: only the client's approval closes it. */
export function FinalApprovalBanner({
  client,
  humanApproved,
}: {
  client?: PieceClientStatus | null;
  humanApproved: boolean;
}) {
  const state = finalApprovalState(client, humanApproved);
  if (!state) return null;
  return (
    <div className={`qa-final-banner tone-${state.tone} ${state.final ? "final" : ""}`} role="status">
      {state.final ? <BadgeCheck size={18} /> : <Building2 size={16} />}
      <div>
        <b>{state.title}</b>
        <span>{state.detail}</span>
      </div>
    </div>
  );
}
