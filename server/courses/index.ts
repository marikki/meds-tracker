// Публічний API модуля: це все, що імпортує хост (окремий застосунок або FamilyHub)
export { createCoursesRouter, type CoursesRouterOptions } from './router';
export { openMedsDb, upsertPeople } from './db';
