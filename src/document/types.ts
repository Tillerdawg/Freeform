export type Identifier = string;

export interface Dot {
  readonly x: number;
  readonly y: number;
}

export interface Performer {
  readonly id: Identifier;
  readonly rankCode: string;
  readonly displayName: string;
  readonly section?: string;
  readonly notes?: string;
}

export interface SetPage {
  readonly id: Identifier;
  readonly name: string;
  readonly startCount: number;
  readonly positions: Readonly<Record<Identifier, Dot>>;
}

export interface FtlDefinition {
  readonly leaderId: Identifier;
  readonly followerIds: readonly Identifier[];
  readonly offsetUnits: Readonly<Record<Identifier, number>>;
  readonly distanceUnits: number;
  readonly path: readonly Dot[];
  readonly expectedEndPositions?: Readonly<Record<Identifier, Dot>>;
}

/** A self-attested local record that acknowledges one computed warning. */
export interface CollisionOverride {
  /** Lexically canonical performer-ID pair, matching the warning's unordered pair. */
  readonly performerIds: readonly [Identifier, Identifier];
  readonly warningSignature: string;
  readonly reason: string;
  readonly overriddenAt: string;
  /** User-entered local actor label; Freeform has no account identity. */
  readonly authorLabel: string;
}

export interface Transition {
  readonly id: Identifier;
  readonly fromSetId: Identifier;
  readonly toSetId: Identifier;
  readonly counts: number;
  readonly mode: 'float' | 'ftl';
  readonly ftl?: FtlDefinition;
  readonly notes?: string;
  readonly collisionOverrides?: readonly CollisionOverride[];
}

/** Exactly one persisted location owns each annotation; no active-page fallback exists. */
export type AnnotationScope =
  | Readonly<{ kind: 'set'; setId: Identifier }>
  | Readonly<{ kind: 'transition'; transitionId: Identifier }>
  | Readonly<{ kind: 'show' }>;

/** Schema names are preserved deliberately: layer `print` is not `printEnabled`. */
export interface AnnotationVisibility {
  readonly editor: boolean;
  readonly print: boolean;
  readonly performerPacket: boolean;
}

interface AnnotationBase {
  readonly id: Identifier;
  readonly layerId: Identifier;
  readonly scope: AnnotationScope;
  readonly visibility: AnnotationVisibility;
  readonly performerId?: Identifier;
}

export interface FreehandAnnotation extends AnnotationBase {
  readonly kind: 'freehand';
  readonly strokes: readonly (readonly Dot[])[];
}

export interface ArrowAnnotation extends AnnotationBase {
  readonly kind: 'arrow';
  readonly points: readonly Dot[];
}

export interface SymbolAnnotation extends AnnotationBase {
  readonly kind: 'symbol';
  readonly symbolId: Identifier;
  readonly anchor: Dot;
  readonly rotationDegrees?: number;
  readonly scale?: number;
}

export interface LabelAnnotation extends AnnotationBase {
  readonly kind: 'label';
  readonly text: string;
  readonly anchor: Dot;
}

export interface PerformerNoteAnnotation extends AnnotationBase {
  readonly kind: 'performerNote';
  readonly performerId: Identifier;
  readonly text: string;
  readonly anchor: Dot;
}

export type Annotation =
  | FreehandAnnotation
  | ArrowAnnotation
  | SymbolAnnotation
  | LabelAnnotation
  | PerformerNoteAnnotation;

export interface AnnotationLayer {
  readonly id: Identifier;
  readonly name: string;
  readonly visible: boolean;
  readonly print: boolean;
  readonly locked: boolean;
}

export interface SymbolDefinition {
  readonly id: Identifier;
  readonly name: string;
  readonly glyph: string;
}

export interface FreeformDocument {
  readonly format: 'freeform';
  readonly formatVersion: '1.0.0';
  readonly show: Readonly<{
    id: Identifier;
    title: string;
    totalCounts: number;
    createdAt?: string;
    updatedAt?: string;
  }>;
  readonly field: Readonly<{
    preset: 'NFHS_11_PLAYER';
    unitsPerYard: 2880;
    lengthUnits: 288000;
    widthUnits: 153600;
    frontHashY: 51200;
    backHashY: 102400;
  }>;
  readonly settings: Readonly<{ collisionThresholdUnits: number }>;
  readonly performers: readonly Performer[];
  readonly sets: readonly SetPage[];
  readonly transitions: readonly Transition[];
  readonly annotations: readonly Annotation[];
  readonly symbols?: readonly SymbolDefinition[];
  readonly layers?: readonly AnnotationLayer[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface DocumentState {
  readonly document: FreeformDocument;
  readonly revision: number;
}

export type DocumentCommand =
  | { readonly type: 'show.title.set'; readonly title: string }
  | { readonly type: 'show.total-counts.set'; readonly totalCounts: number }
  | {
    /**
     * A performer is created together with one valid dot for every existing
     * set, preserving the complete-set invariant atomically.
     */
    readonly type: 'performer.create';
    readonly performer: Performer;
    readonly positionsBySet: Readonly<Record<Identifier, Dot>>;
  }
  | { readonly type: 'performer.remove'; readonly performerId: Identifier }
  | {
    readonly type: 'performer.displayName.batchSet';
    readonly updates: Readonly<Record<Identifier, string>>;
  }
  | { readonly type: 'set.create'; readonly set: SetPage }
  | { readonly type: 'set.remove'; readonly setId: Identifier }
  | { readonly type: 'set.reorder'; readonly setId: Identifier; readonly startCount: number }
  | {
    readonly type: 'set.performer.add';
    readonly setId: Identifier;
    readonly performerId: Identifier;
    readonly dot: Dot;
  }
  | {
    readonly type: 'set.performer.remove';
    readonly setId: Identifier;
    readonly performerId: Identifier;
  }
  | {
    readonly type: 'dot.create';
    readonly setId: Identifier;
    readonly performerId: Identifier;
    readonly dot: Dot;
  }
  | {
    readonly type: 'dot.move';
    readonly setId: Identifier;
    readonly performerId: Identifier;
    readonly dot: Dot;
  }
  | { readonly type: 'transition.create'; readonly transition: Transition }
  | { readonly type: 'transition.remove'; readonly transitionId: Identifier }
  | { readonly type: 'settings.collision-threshold.set'; readonly collisionThresholdUnits: number }
  | {
    readonly type: 'collision.override.record';
    readonly transitionId: Identifier;
    readonly override: CollisionOverride;
  }
  | { readonly type: 'annotation.create'; readonly annotation: Annotation }
  /** Replacement preserves the annotation ID; partial patches would weaken validation. */
  | { readonly type: 'annotation.update'; readonly annotation: Annotation }
  | { readonly type: 'annotation.remove'; readonly annotationId: Identifier }
  | { readonly type: 'layer.create'; readonly layer: AnnotationLayer }
  | { readonly type: 'layer.update'; readonly layer: AnnotationLayer }
  | { readonly type: 'layer.reorder'; readonly layerId: Identifier; readonly index: number }
  | { readonly type: 'layer.remove'; readonly layerId: Identifier }
  | { readonly type: 'symbol.create'; readonly symbol: SymbolDefinition }
  | { readonly type: 'symbol.update'; readonly symbol: SymbolDefinition }
  | { readonly type: 'symbol.remove'; readonly symbolId: Identifier }
  | { readonly type: 'document.replace'; readonly document: FreeformDocument };

export interface CommandStore {
  getState(): DocumentState;
  apply(command: DocumentCommand): DocumentState;
  undo(): DocumentState | undefined;
  redo(): DocumentState | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  getUndoCommands(): readonly DocumentCommand[];
}
