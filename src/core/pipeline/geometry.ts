export interface GridSize {
  width: number;
  height: number;
}

/** 语义 = 长边 N 格，锁宽高比，绝不拉伸。 */
export function deriveLongEdgeGrid(srcWidth: number, srcHeight: number, longEdge: number): GridSize {
  const edge = Math.max(1, Math.floor(longEdge));
  if (srcWidth >= srcHeight) {
    return {
      width: edge,
      height: Math.max(1, Math.round((srcHeight * edge) / srcWidth))
    };
  }
  return {
    width: Math.max(1, Math.round((srcWidth * edge) / srcHeight)),
    height: edge
  };
}

/** 方形底板 contain：内容等比放入，返回实际内容格数。 */
export function deriveContainContent(
  srcWidth: number,
  srcHeight: number,
  boardWidth: number,
  boardHeight: number
): GridSize {
  const scale = Math.min(boardWidth / srcWidth, boardHeight / srcHeight);
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale))
  };
}
