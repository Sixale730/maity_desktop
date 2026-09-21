import React from "react";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { About } from "@/components/settings/About";

interface InfoProps {
    isCollapsed: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button 
          ref={ref} 
          className={`flex items-center justify-center mb-2 cursor-pointer border-none transition-colors ${
            isCollapsed 
              ? "bg-transparent p-2 hover:bg-sidebar-accent rounded-lg"
              : "w-full px-3 py-1.5 mt-1 text-sm font-medium text-secondary-foreground bg-secondary hover:bg-secondary/80 rounded-lg shadow-sm"
          }`}
          title="Acerca de Maity"
        >
          <InfoIcon className={`text-muted-foreground ${isCollapsed ? "w-5 h-5" : "w-4 h-4"}`} />
          {!isCollapsed && (
            <span className="ml-2 text-sm text-secondary-foreground">Acerca de</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>Acerca de Maity</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Info.displayName = "About";

export default Info; 