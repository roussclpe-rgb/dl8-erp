import { Dialog, DialogTitle, DialogContent, IconButton, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

export default function FormDialog({ open, title, onClose, children, maxWidth = "sm", disableClose = false }) {
  return (
    <Dialog open={open} onClose={disableClose ? undefined : onClose} maxWidth={maxWidth} fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 700 }}>
        {title}
        <IconButton onClick={onClose} disabled={disableClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 3 }}>{children}</DialogContent>
    </Dialog>
  );
}
