// feature 026 (FR-008): the ONLY import site for the icon family (Remix).
// One concept → one icon. tests/ui-audit.test.ts (icon-import-site) enforces
// that no other file imports the icon package directly. To change families,
// edit this file only.
import type { RemixiconComponentType } from "@remixicon/react";
import { RiDraggable, RiAddLine, RiAlertLine, RiArrowDownSLine, RiArrowGoBackLine, RiArrowLeftSLine, RiArrowRightSLine, RiArrowUpSLine, RiAttachment2, RiBookShelfLine, RiChat3Line, RiChatNewLine, RiCheckLine, RiCheckboxCircleLine, RiCircleLine, RiCloseLine, RiComputerLine, RiDashboard3Line, RiDeleteBinLine, RiDownload2Line, RiEqualizerLine, RiErrorWarningLine, RiExpandUpDownLine, RiFileCodeLine, RiFileCopyLine, RiFileLine, RiFileTextLine, RiFlagLine, RiFolderLine, RiFolderOpenLine, RiGitBranchLine, RiGroupLine, RiInformationLine, RiLayoutLeftLine, RiLinkM, RiLoader4Line, RiMoonLine, RiMoreLine, RiPencilLine, RiPriceTag3Line, RiPuzzleLine, RiRefreshLine, RiSearchLine, RiSendPlaneLine, RiSettings3Line, RiSparklingLine, RiStopLine, RiSunLine, RiTerminalBoxLine, RiUpload2Line } from "@remixicon/react";

export type IconComponent = RemixiconComponentType;

// named icon sizes (px): sm 14 = size-3.5, md 16 = size-4, lg 20 = size-5
export const ICON_SIZE = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const;

export const IconCheck: IconComponent = RiCheckLine;
export const IconSuccess: IconComponent = RiCheckboxCircleLine;
export const IconError: IconComponent = RiErrorWarningLine;
export const IconWarning: IconComponent = RiAlertLine;
export const IconInfo: IconComponent = RiInformationLine;
export const IconSpinner: IconComponent = RiLoader4Line;
export const IconClose: IconComponent = RiCloseLine;
export const IconChevronRight: IconComponent = RiArrowRightSLine;
export const IconChevronLeft: IconComponent = RiArrowLeftSLine;
export const IconChevronDown: IconComponent = RiArrowDownSLine;
export const IconChevronUp: IconComponent = RiArrowUpSLine;
export const IconExpand: IconComponent = RiExpandUpDownLine;
export const IconDot: IconComponent = RiCircleLine;
export const IconAdd: IconComponent = RiAddLine;
export const IconDelete: IconComponent = RiDeleteBinLine;
export const IconEdit: IconComponent = RiPencilLine;
export const IconCopy: IconComponent = RiFileCopyLine;
export const IconRefresh: IconComponent = RiRefreshLine;
export const IconUndo: IconComponent = RiArrowGoBackLine;
export const IconAttach: IconComponent = RiAttachment2;
export const IconDownload: IconComponent = RiDownload2Line;
export const IconUpload: IconComponent = RiUpload2Line;
export const IconSend: IconComponent = RiSendPlaneLine;
export const IconStop: IconComponent = RiStopLine;
export const IconSearch: IconComponent = RiSearchLine;
export const IconMore: IconComponent = RiMoreLine;
export const IconSettings: IconComponent = RiSettings3Line;
export const IconSliders: IconComponent = RiEqualizerLine;
export const IconBenchmark: IconComponent = RiDashboard3Line;
export const IconSidebar: IconComponent = RiLayoutLeftLine;
export const IconChat: IconComponent = RiChat3Line;
export const IconNewChat: IconComponent = RiChatNewLine;
export const IconBranch: IconComponent = RiGitBranchLine;
export const IconUsers: IconComponent = RiGroupLine;
export const IconTags: IconComponent = RiPriceTag3Line;
export const IconFlag: IconComponent = RiFlagLine;
export const IconSparkle: IconComponent = RiSparklingLine;
export const IconExtension: IconComponent = RiPuzzleLine;
export const IconLibrary: IconComponent = RiBookShelfLine;
export const IconTerminal: IconComponent = RiTerminalBoxLine;
export const IconFile: IconComponent = RiFileLine;
export const IconLink: IconComponent = RiLinkM;
export const IconFileCode: IconComponent = RiFileCodeLine;
export const IconFileText: IconComponent = RiFileTextLine;
export const IconFolder: IconComponent = RiFolderLine;
export const IconFolderOpen: IconComponent = RiFolderOpenLine;
export const IconLight: IconComponent = RiSunLine;
export const IconDark: IconComponent = RiMoonLine;
export const IconSystem: IconComponent = RiComputerLine;
export const IconGrip: IconComponent = RiDraggable;
