import React from 'react';
import {
  AudioLines, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Copy, Ellipsis, FileAudio, FileText,
  GripVertical, Image, Loader, Lock, Mic, NotebookPen, Pause, Pencil, Play, RotateCcw, RotateCw,
  Search, Server, Share, Square, SquareCheck, Trash2, Undo2, UserRound, UsersRound, X, type LucideIcon,
} from 'lucide-react-native';
import { colors } from '../lib/theme';

// One quiet icon family: Lucide at a 1.8 stroke (GUIDELINE §6), the same set KEEPLACE uses. No emoji
// anywhere in the UI. Screens import from here, never from lucide directly, so the stroke and the
// default colours stay consistent. Colours are always tokens: heading in header buttons, muted when
// inactive, primaryDark when active, onPrimary on fills.
export type IconProps = { size?: number; color?: string; strokeWidth?: number };

const STROKE = 1.8;

const make = (Icon: LucideIcon, defaultColor: string, opts: { fill?: boolean } = {}) =>
  function AppIcon({ size = 24, color = defaultColor, strokeWidth = STROKE }: IconProps) {
    // Play/pause read as solid glyphs on the round primary button.
    return <Icon size={size} color={color} strokeWidth={strokeWidth} fill={opts.fill ? color : 'none'} />;
  };

// Playback
export const IconPlay = make(Play, colors.onPrimary, { fill: true });
export const IconPause = make(Pause, colors.onPrimary, { fill: true });
/** Skip back / forward — the caller overlays the 15 / 30. */
export const IconRewind = make(RotateCcw, colors.muted);
export const IconForward = make(RotateCw, colors.muted);

// Status
export const IconAlert = make(CircleAlert, colors.danger);
export const IconCheck = make(Check, colors.primaryDark);
export const IconLoader = make(Loader, colors.primaryDark);

// Actions
export const IconPencil = make(Pencil, colors.heading);
export const IconCopy = make(Copy, colors.heading);
export const IconShare = make(Share, colors.heading);
export const IconTrash = make(Trash2, colors.danger);
export const IconLock = make(Lock, colors.muted);
export const IconImage = make(Image, colors.heading);
export const IconFile = make(FileAudio, colors.heading);
export const IconFileAudio = IconFile;
export const IconSearch = make(Search, colors.heading);
export const IconGrip = make(GripVertical, colors.muted);
export const IconChevronUp = make(ChevronUp, colors.heading);
export const IconChevronDown = make(ChevronDown, colors.heading);
export const IconChevronRight = make(ChevronRight, colors.muted);
export const IconChevronLeft = make(ChevronLeft, colors.heading);
export const IconMore = make(Ellipsis, colors.heading);
export const IconRegenerate = make(RotateCw, colors.heading);
export const IconMic = make(Mic, colors.onPrimary);
export const IconStop = make(Square, colors.onPrimary, { fill: true });
export const IconUndo = make(Undo2, colors.heading);
export const IconClose = make(X, colors.heading);
export const IconUser = make(UserRound, colors.heading);
export const IconServer = make(Server, colors.heading);

// Content
export const IconTranscript = make(FileText, colors.muted);
export const IconNotes = make(NotebookPen, colors.muted);
export const IconSpeakers = make(UsersRound, colors.heading);
export const IconAudioLines = make(AudioLines, colors.primaryDark);
export const IconTodo = make(Square, colors.primaryDark);
export const IconTodoDone = make(SquareCheck, colors.primaryDark);
