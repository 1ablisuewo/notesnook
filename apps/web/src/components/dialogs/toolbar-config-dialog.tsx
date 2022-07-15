import { Button, Flex, FlexProps, Text } from "rebass";
import { Perform } from "../../common/dialog-controller";
import Dialog from "./dialog";
import {
  getAllTools,
  getToolDefinition,
  Icon,
  Icons,
  ToolbarGroupDefinition,
  ToolDefinition,
  ToolId,
} from "notesnook-editor";
import {
  closestCenter,
  DndContext,
  useSensor,
  useSensors,
  KeyboardSensor,
  PointerSensor,
  DragOverlay,
  MeasuringStrategy,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useEffect, useState } from "react";
import { CSS } from "@dnd-kit/utilities";
import { createPortal } from "react-dom";
import id from "notes-core/utils/id";
import { Label, Radio } from "@rebass/forms";
import { db } from "../../common/db";
import { useToolbarConfig } from "../editor/context";
import {
  getAllPresets,
  getCurrentPreset,
  getPreset,
  getPresetTools,
  Preset,
  PresetId,
} from "../../common/toolbar-config";
import { showToast } from "../../utils/toast";

export type ToolbarConfigDialogProps = {
  onClose: Perform;
};

const ReactModalContent = document.querySelector(".ReactModal__Overlay");

export function ToolbarConfigDialog(props: ToolbarConfigDialogProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const [items, setItems] = useState<TreeNode[]>([]);
  const [activeItem, setActiveItem] = useState<TreeNode>();
  const [currentPreset, setCurrentPreset] = useState<Preset>(
    getCurrentPreset()
  );
  const { setToolbarConfig } = useToolbarConfig();

  useEffect(() => {
    const items = flatten(getPresetTools(currentPreset));
    items.push(createTrash());
    items.push(...flatten([getDisabledTools(items)]).slice(1));
    setItems(items);
  }, [currentPreset]);

  return (
    <Dialog
      isOpen={true}
      title={"Configure toolbar"}
      description={"Customize the editor toolbar to fit your needs."}
      width={500}
      onClose={props.onClose}
      positiveButton={{
        text: "Save",
        onClick: async () => {
          const tools = unflatten(items.slice(0, items.length - 1));

          await db.settings?.setToolbarConfig("desktop", {
            preset: currentPreset.id,
            config: currentPreset.id === "custom" ? tools : undefined,
          });

          setToolbarConfig(tools);
          props.onClose(true);
        },
      }}
      negativeButton={{ text: "Cancel", onClick: props.onClose }}
    >
      <Flex sx={{ flexDirection: "column" }}>
        <Flex
          sx={{ p: 1, justifyContent: "space-between", alignItems: "center" }}
        >
          <Flex>
            {getAllPresets().map((preset) => (
              <Label
                key={preset.id}
                variant="text.body"
                sx={{ alignItems: "center", width: "auto", mr: 2 }}
              >
                <Radio
                  id={preset.id.toString()}
                  name="preset"
                  value={preset.id}
                  checked={preset.id === currentPreset.id}
                  onChange={(e) => {
                    const { value } = e.target;
                    setCurrentPreset(getPreset(value as PresetId));
                  }}
                />
                {preset.title}
              </Label>
            ))}
          </Flex>
          {currentPreset.editable && (
            <Button
              variant={"secondary"}
              sx={{
                display: "flex",
                flexShrink: 0,
                alignItems: "center",
                p: 1,
              }}
              title="Add group"
              onClick={() => {
                setItems(addGroup);
                showToast("success", "Group added successfully");
              }}
            >
              <Icon path={Icons.plus} color="text" size={18} />
            </Button>
          )}
        </Flex>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) => {
            if (currentPreset.id !== "custom") {
              setCurrentPreset((c) => ({
                ...getPreset("custom"),
                tools: getPresetTools(c),
              }));
            }

            const { active } = event;
            const activeItem = items.find((item) => item.id === active.id);
            setActiveItem(activeItem);
          }}
          onDragEnd={(event) => {
            const { active, over } = event;
            if (activeItem && over && active.id !== over.id) {
              // const newIndex = items.findIndex((i) => i.id === over.id);
              if (isGroup(activeItem) || isSubgroup(activeItem)) {
                setItems(moveGroup(items, activeItem.id, over.id as string));
              } else {
                setItems(moveItem(items, activeItem.id, over.id as string));
              }

              setTimeout(() => {
                const element = document.getElementById(over.id as string);
                element?.scrollIntoView({ behavior: "auto", block: "nearest" });
              }, 500);
            }
            setActiveItem(undefined);
          }}
          measuring={{
            droppable: { strategy: MeasuringStrategy.Always },
          }}
        >
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            {items?.map((item, index) => {
              const deleted = isDeleted(items, item);
              const hasSubGroup =
                isGroup(item) &&
                !!getGroup(items, item.id)?.items.some((t) => isSubgroup(t));
              const canAddSubGroup =
                currentPreset.editable && !deleted && !hasSubGroup;
              const canRemoveGroup = currentPreset.editable && !deleted;
              const canRemoveItem = currentPreset.editable && !deleted;

              return (
                <TreeNodeComponent
                  key={item.id}
                  item={item}
                  activeItem={activeItem}
                  onAddSubGroup={
                    canAddSubGroup
                      ? () => {
                          setItems((items) => addSubGroup(items, item.id));
                          showToast("success", "Subgroup added successfully");
                        }
                      : undefined
                  }
                  onRemoveGroup={
                    canRemoveGroup
                      ? (group) => {
                          setItems(removeGroup(items, group.id));
                        }
                      : undefined
                  }
                  onRemoveItem={
                    canRemoveItem
                      ? (item) => {
                          setItems(removeItem(items, item.id));
                        }
                      : undefined
                  }
                />
              );
            })}
            {activeItem &&
              createPortal(
                <DragOverlay
                // dropAnimation={dropAnimationConfig}
                // modifiers={indicator ? [adjustTranslate] : undefined}
                >
                  <TreeNodeComponent overlay item={activeItem} />
                </DragOverlay>,
                ReactModalContent || document.body
              )}
          </SortableContext>
        </DndContext>
      </Flex>
    </Dialog>
  );
}

type TreeNodeComponentProps = {
  item: TreeNode;
  activeItem?: TreeNode;
  overlay?: boolean;
  onRemoveGroup?: (item: TreeNode) => void;
  onAddSubGroup?: () => void;
  onRemoveItem?: (item: TreeNode) => void;
};
function TreeNodeComponent(props: TreeNodeComponentProps) {
  const {
    item,
    activeItem,
    onRemoveGroup,
    onRemoveItem,
    onAddSubGroup,
    ...restProps
  } = props;
  if (activeItem && isCollapsed(item, activeItem)) return null;
  const isDraggable = !isTrash(item);

  if (isGroup(item) || isSubgroup(item)) {
    return (
      <SortableWrapper
        {...restProps}
        item={item}
        draggable={isDraggable}
        onRemove={onRemoveGroup}
        onAdd={isGroup(item) ? onAddSubGroup : undefined}
        sx={{
          bg: "background",
          border: "1px solid var(--border)",
          borderRadius: "default",
          p: 1,
          mb: 1,
          ml: item.depth * 15,
          alignItems: "center",
        }}
      >
        {isDraggable ? (
          <Icon path={Icons.dragHandle} size={18} color="icon" />
        ) : null}
        <Text variant={"body"} sx={{ ml: 1 }}>
          {item.title}
        </Text>
      </SortableWrapper>
    );
  }

  return (
    <SortableWrapper
      {...restProps}
      item={item}
      draggable={isDraggable}
      onRemove={onRemoveItem}
      sx={{
        p: 1,
        alignItems: "center",
        justifyContent: "space-between",
        bg: "bgSecondary",
        borderRadius: "default",
        mb: 1,
        ml: item.depth * 15,
        ":last-of-type": { mb: 0 },
      }}
    >
      {item.icon && (
        <Icon path={(Icons as any)[item.icon]} size={16} color="icon" />
      )}
      <Text variant={"body"} sx={{ ml: 1 }}>
        {item.title}
      </Text>
    </SortableWrapper>
  );
}

type SortableWrapperProps = TreeNodeComponentProps &
  FlexProps & { onRemove?: (item: TreeNode) => void; onAdd?: () => void };

function SortableWrapper(props: SortableWrapperProps) {
  const {
    item,
    activeItem,
    overlay,
    sx,
    children,
    draggable,
    onRemove,
    onAdd,
    ...flexProps
  } = props;
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item.id });
  const visibility =
    !overlay && item.id === activeItem?.id ? "hidden" : "visible";

  return (
    <Flex
      {...flexProps}
      id={overlay ? `overlay-${item.id}` : item.id}
      ref={setNodeRef}
      sx={{
        pointerEvents: draggable ? "all" : "none",
        cursor: overlay ? "grabbing" : draggable ? "grab" : "unset",
        visibility,
        transform: CSS.Transform.toString(transform),
        transition,
        justifyContent: "space-between",
        ":hover #remove-item, :hover #add-item": { opacity: 1 },
        ...sx,
      }}
    >
      <Flex
        {...listeners}
        {...attributes}
        sx={{ alignItems: "center", flex: 1 }}
      >
        {children}
      </Flex>
      <Flex sx={{ alignItems: "center" }}>
        {onAdd && (
          <Button
            id="add-item"
            variant={"tool"}
            sx={{ p: "small", opacity: 0, mr: 1 }}
            onClick={(e) => {
              onAdd();
            }}
          >
            <Icon path={Icons.plus} size={16} color="icon" />
          </Button>
        )}
        {onRemove && (
          <Button
            id="remove-item"
            variant={"tool"}
            sx={{ p: "small", opacity: 0 }}
            onClick={(e) => {
              onRemove(item);
            }}
          >
            <Icon path={Icons.delete} size={16} color="icon" />
          </Button>
        )}
      </Flex>
    </Flex>
  );
}

type TreeNodeType = "group" | "item";
type BaseTreeNode<Type extends TreeNodeType> = {
  type: Type;
  id: string;
  title: string;
  depth: number;
};

type Subgroup = BaseTreeNode<"group"> & {
  collapsed?: boolean;
};

type Group = BaseTreeNode<"group">;

type Item = BaseTreeNode<"item"> & {
  toolId: string;
  icon: string;
  collapsed?: boolean;
};

type TreeNode = Group | Item | Subgroup;

function flatten(
  tools: ToolbarGroupDefinition[],
  depth: number = 0
): TreeNode[] {
  let nodes: TreeNode[] = [];
  let groupCount = 1;
  for (const tool of tools) {
    if (Array.isArray(tool)) {
      const isSubgroup = depth > 0;
      const groupTitle = `${isSubgroup ? "Subgroup" : "Group"} ${groupCount}`;

      nodes.push(createGroup({ depth, title: groupTitle }));
      nodes.push(...flatten(tool as ToolbarGroupDefinition[], depth + 1));
      ++groupCount;
    } else {
      const { icon, title } = getToolDefinition(tool as any);
      nodes.push(createItem({ toolId: tool, depth, title, icon }));
    }
  }
  return nodes;
}

function unflatten(items: TreeNode[]): ToolbarGroupDefinition[] {
  let tools: ToolbarGroupDefinition[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isGroup(item) || isSubgroup(item)) {
      const group = getGroup(items, item.id);
      console.log(group?.items);
      if (!group) continue;
      tools.push(unflatten(group.items.slice(1)) as any);

      // skip all the group's items
      i += group.items.length - 1;
    } else {
      tools.push(item.toolId as any);
    }
  }
  return tools;
}

function createGroup(config: Partial<Group>): Group {
  return {
    type: "group",
    id: id(),
    depth: 0,
    title: "Group",
    ...config,
  };
}

function createItem(config: Partial<Item>): Item {
  return {
    type: "item",
    id: id(),
    depth: 0,
    title: "",
    icon: "",
    toolId: "",
    ...config,
  };
}

function createTrash() {
  return createGroup({
    id: "trash",
    depth: 0,
    title: "Disabled items",
  });
}

function moveGroup(
  items: TreeNode[],
  fromId: string,
  toId: string
): TreeNode[] {
  const newArray = items.slice();
  const fromGroup = getGroup(items, fromId);
  const toGroup = getGroup(items, toId);

  if (!fromGroup || !toGroup || !canMoveGroup(fromGroup, toGroup)) return items;

  newArray.splice(fromGroup.index, fromGroup.items.length);
  const newIndex =
    // if we are moving the group upwards
    fromGroup.index > toGroup.index
      ? toGroup.index
      : toGroup.index + toGroup.items.length - fromGroup.items.length;

  newArray.splice(
    newIndex,
    0,
    ...fromGroup.items.map((item) => {
      if (item.depth) item.depth = toGroup.item.depth + 1;
      return item;
    })
  );
  return newArray;
}

function canMoveGroup(
  fromGroup: ResolvedGroup,
  toGroup: ResolvedGroup
): boolean {
  const hasOtherGroups =
    toGroup.items.filter((item) => isGroup(item) || isSubgroup(item)).length >
    1;

  // 1 group can contain only 1 subgroup
  if (isSubgroup(fromGroup.item) && hasOtherGroups) return false;

  return true;
}

function moveItem(items: TreeNode[], fromId: string, toId: string): TreeNode[] {
  const fromIndex = items.findIndex((i) => i.id === fromId);
  const toIndex = items.findIndex((i) => i.id === toId);

  const fromItem = items[fromIndex];
  const toItem = items[toIndex];

  if (!fromItem || !isItem(fromItem)) return items;

  const movingToGroup = isGroup(toItem) || isSubgroup(toItem);

  // we need to adjust the item depth according to where the item
  // is going to be moved.
  if (fromItem.depth !== toItem.depth) fromItem.depth = toItem.depth;

  // if we are moving to the start of the group, we need to adjust the
  // depth accordingly.
  if (movingToGroup) fromItem.depth = toItem.depth + 1;

  const newArray = arrayMove(items, fromIndex, toIndex);

  // do not allow moving an item if there's no group over it
  if (!isGroup(getItemGroup(newArray, fromItem))) return items;

  return newArray;
}

function removeGroup(items: TreeNode[], groupId: string): TreeNode[] {
  const newArray = items.slice();
  const fromGroup = getGroup(items, groupId);
  const toGroup = getGroup(items, "trash");

  if (!fromGroup || !toGroup) return items;

  newArray.splice(fromGroup.index, fromGroup.items.length);
  const newIndex =
    // if we are moving the group upwards
    fromGroup.index > toGroup.index
      ? toGroup.index
      : toGroup.index + toGroup.items.length - fromGroup.items.length;

  newArray.splice(
    newIndex,
    0,
    ...fromGroup.items
      .filter((item) => isItem(item))
      .map((item) => {
        item.depth = toGroup.item.depth + 1;
        return item;
      })
  );
  return newArray;
}

function removeItem(items: TreeNode[], itemId: string): TreeNode[] {
  const toGroup = getGroup(items, "trash");
  if (!toGroup) return items;

  return moveItem(
    items,
    itemId,
    toGroup.items.length > 0
      ? toGroup.items[toGroup.items.length - 1].id
      : toGroup.item.id
  );
}

function isCollapsed(item: TreeNode, activeItem: TreeNode): boolean {
  // if a group is selected, we collapse everything else.
  if (isGroup(activeItem) && (isSubgroup(item) || isItem(item))) {
    return true;
  }

  // if a subgroup is selected, we collapse only the items.
  if (isSubgroup(activeItem) && isItem(item)) return true;

  return false;
}

function isSubgroup(item: TreeNode): item is Subgroup {
  return item.type === "group" && item.depth > 0;
}

function isGroup(item: TreeNode): item is Group {
  return item.type === "group" && item.depth === 0;
}

function isItem(item: TreeNode): item is Item {
  return item.type === "item";
}

function isTrash(item: TreeNode): boolean {
  return item.id === "trash";
}

function isDeleted(items: TreeNode[], item: TreeNode): boolean {
  const group = getItemGroup(items, item);
  return group.id === "trash";
}

function getItemGroup(items: TreeNode[], item: TreeNode) {
  const index = items.findIndex((i) => i.id === item.id);
  for (let i = index; i >= 0; --i) {
    const item = items[i];
    if (isGroup(item) || isSubgroup(item)) return item;
  }
  return items[0];
}

type ResolvedGroup = {
  index: number;
  item: Group;
  items: TreeNode[];
};
function getGroup(items: TreeNode[], groupId: string): ResolvedGroup | null {
  const index = items.findIndex((item) => item.id === groupId);
  const group = items[index];
  if (!isGroup(group) && !isSubgroup(group)) return null;

  const nextGroupIndex = items.findIndex(
    (item, i) => i > index && (item.depth === 0 || item.depth < group.depth)
  );
  return {
    index,
    item: group,
    items: items.slice(
      index,
      nextGroupIndex < 0 ? items.length : nextGroupIndex
    ),
  };
}

function addSubGroup(items: TreeNode[], groupId: string) {
  const group = getGroup(items, groupId);
  if (!group) return items;
  const newArray = items.slice();
  newArray.splice(
    group.index + group.items.length,
    0,
    createGroup({ title: "Subgroup 1", depth: 1 })
  );
  return newArray;
}

function addGroup(items: TreeNode[]) {
  let insertIndex = items.length;
  const trashIndex = items.findIndex((item) => isTrash(item));
  if (trashIndex > -1) insertIndex = trashIndex;

  const newArray = items.slice();
  const groups = items.filter((t) => isGroup(t) && !isSubgroup(t));
  const newGroup = createGroup({ title: `Group ${groups.length}` });
  newArray.splice(insertIndex, 0, newGroup);
  return newArray;
}

export function getDisabledTools(tools: TreeNode[]) {
  const allTools = getAllTools() as Record<string, ToolDefinition>;
  const disabled: ToolbarGroupDefinition = [];
  const items: Item[] = tools.filter((t) => isItem(t)) as Item[];
  for (const key in allTools) {
    const tool = allTools[key];
    if (tool.conditional) continue;
    if (items.findIndex((t) => t.toolId === key) <= -1)
      disabled.push(key as ToolId);
  }
  return disabled;
}