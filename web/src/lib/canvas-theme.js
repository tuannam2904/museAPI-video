// Token màu cho canvas vô hạn (chủ đề tối — hiện chỉ có dark, chưa hỗ trợ light).
// Lấy đúng màu đang dùng trong Canvas.jsx / NodeInspector.jsx để refactor
// sang token mà không đổi giao diện: panel #121726, nền #080b13,
// brand/mint #4fe3c1, chữ mist #b8c0d0 / #8b94a8 / #6b7488.
export const canvasTheme = {
  dark: {
    canvas: {
      background: '#080b13', // nền canvas (lớp .dot-grid)
      dot: 'rgba(255,255,255,0.07)', // chấm lưới nền
      gridLine: 'rgba(255,255,255,0.07)', // kẻ lưới nền
      selectionStroke: '#4fe3c1', // viền chọn / đường nối đang kéo
      selectionFill: 'rgba(79,227,193,0.10)', // nền vùng chọn
    },
    node: {
      fill: '#151a2b', // nền nút (.glass-node)
      panel: '#121726', // nền bảng cấu hình nút
      panelOverlay: 'rgba(18,23,38,0.95)', // nền bảng cấu hình nút (mờ 95%)
      stroke: 'rgba(255,255,255,0.08)', // viền nút
      activeStroke: '#4fe3c1', // viền nút đang chọn / viền bảng cấu hình
      text: '#dde3ee', // chữ chính
      muted: '#8b94a8', // chữ phụ
      faint: '#6b7488', // chữ mờ nhất
      label: '#b8c0d0', // chữ nhãn
    },
    toolbar: {
      panel: 'rgba(18,23,38,0.90)', // nền dock / thanh công cụ (#121726/90)
      border: 'rgba(255,255,255,0.07)', // viền dock
      item: '#8b94a8', // màu icon nút thường
      itemHover: 'rgba(255,255,255,0.05)', // nền hover nút
      activeBg: 'rgba(255,255,255,0.08)', // nền nút đang bật
      activeText: '#4fe3c1', // chữ/icon nút đang bật (brand)
    },
  },
};

// Hiện chỉ có chủ đề tối; light chưa hỗ trợ (xem popover Giao diện).
export function getCanvasTheme() {
  return canvasTheme.dark;
}
