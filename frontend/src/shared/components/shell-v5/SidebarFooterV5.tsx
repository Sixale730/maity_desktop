import { useNavigate } from '@/lib/router-compat';
import { ChevronsUpDown, LogOut, User } from 'lucide-react';
import { supabase, useAvatarWithDefault } from '@maity/shared';
import { useUser } from '@/contexts/UserContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LazyVoxelAvatar } from '@/features/avatar/components/LazyVoxelAvatar';
import { AdminViewRoleSelector } from '@/shared/components/AdminViewRoleSelector';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';

/**
 * Footer for the v5 sidebars (Practica/Productividad/Combined).
 *
 * Stacks (top → bottom):
 *   1. AdminViewRoleSelector — visible only when `actualRole === 'admin'`
 *      (component returns `null` otherwise). Lets the admin preview the UI as
 *      manager/user via `ViewRoleContext`. Same selector that lived in
 *      NavigationHeader for the AppLayout legacy routes.
 *   2. User profile button — opens a dropdown with name/email/avatar/logout,
 *      replacing the affordance that lived in SidebarUserFooter (shadcn-based)
 *      and UserMenuDropdown (NavigationHeader). Without this, shell v5 routes
 *      had no logout affordance.
 */
export function SidebarFooterV5() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { userProfile } = useUser();
  const { avatar } = useAvatarWithDefault(userProfile?.id);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    <div className="border-t border-border flex flex-col gap-2 p-2">
      <AdminViewRoleSelector />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-card/50 transition-colors"
          >
            <LazyVoxelAvatar
              config={avatar}
              size="xs"
              className="rounded-md overflow-hidden"
            />
            <span className="flex-1 text-left text-sm font-medium truncate text-foreground">
              {userProfile?.name || t('roles.default_user')}
            </span>
            <ChevronsUpDown className="size-3.5 text-foreground/40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-none">
                {userProfile?.name || t('roles.default_user')}
              </span>
              {userProfile?.email && (
                <span className="text-xs text-muted-foreground truncate">
                  {userProfile.email}
                </span>
              )}
              {userProfile?.role && (
                <span className="text-xs text-muted-foreground capitalize">
                  {userProfile.role}
                </span>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => navigate('/avatar')}
            className="cursor-pointer"
          >
            <User className="mr-2 h-4 w-4" />
            {t('nav.avatar')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            className="cursor-pointer text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t('nav.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
