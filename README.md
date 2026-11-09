# NEXUS | منصة المراسلة والتواصل الاجتماعي المتكاملة

حزمة ملفات موجهة لأدوات ووكلاء الذكاء الاصطناعي المستقلة (Devin, Cursor Composer, Claude Code, Windsurf) لبناء التطبيق ذاتياً دون أي تدخل بشري.

## البدء السريع للوكيل الذكي
1. فك ضغط الحزمة:
   ```bash
   unzip nexus-autonomous-agent.zip
   cd nexus-autonomous-agent
   ```

## تشغيل NEXUS محلياً

المشروع يستخدم npm workspaces مع Next.js وFastify وPostgreSQL وRedis وMinIO.

1. ثبّت Node.js وDocker Desktop، ثم انسخ `.env.example` إلى `.env`.
2. شغّل خدمات البيانات: `docker compose up -d`.
3. من مجلد المشروع، نفّذ `npm install` ثم `npm run db:migrate`.
4. شغّل الواجهة والخادم معاً عبر `npm run dev`؛ الواجهة على `http://localhost:3000` وواجهة API على `http://localhost:4000`.
5. استخدم `npm run build` و`npm run typecheck` للتحقق من البناء والأنواع.

التطبيق يتضمن جلسات JWT متجددة، تجزئة كلمات مرور Argon2id، واجهات REST وSocket.IO، تحميل ملفات موقّعاً، وقنوات القصص والتصويت. مكالمات WebRTC تستخدم STUN عاماً؛ الاتصال عبر شبكات NAT الصعبة يحتاج إعداد TURN حقيقياً في بيئة النشر. تكامل Signal Protocol لم يكتمل بعد، لذلك لا ينبغي عرض محتوى الرسائل الحالية على أنه مشفّر من طرف إلى طرف.
2. توجيه الوكيل:
   قم بنسخ الأمر التالي وأعطه للوكيل:
   ```text
   Read .agent/AGENT_INSTRUCTIONS.md, PRD.md, and TASKS.md. Follow the plan step-by-step, spin up the Docker services, run database migrations, and build the entire NEXUS application autonomously until all tasks in TASKS.md are checked.
   ```
